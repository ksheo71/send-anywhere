# 2단계 — WebRTC P2P 실시간 전송 설계

작성일: 2026-07-07
상태: 설계 승인됨 (스펙 검토 대기)

## 1. 목적과 범위

기존 서버 릴레이(1단계)에 더해 **브라우저 간 직접 전송(P2P)** 모드를 추가한다. 양쪽이 동시에
온라인일 때 파일이 서버를 거치지 않고 WebRTC DataChannel로 직접 전송된다. 서버는 연결 중개
(시그널링)만 하며 파일을 저장하지 않는다.

- **이번 범위**: STUN만 사용하는 P2P. 시그널링은 자체 WebSocket. 안 되는 네트워크는 릴레이로
  안내(자동 폴백은 3단계에서).
- **제외**: TURN(다음 단계), P2P↔릴레이 자동 폴백(3단계). 1:N 전송(1:1만).
- **불변**: 1단계 릴레이 코드·API·백엔드 스토어는 그대로 두고 **추가만** 한다. 릴레이 테스트
  40+ 는 계속 통과해야 한다.

## 2. 아키텍처

```
[보내는 브라우저] ──WS 시그널링(코드=방)──► Fastify /ws ◄──WS── [받는 브라우저]
        └──────── WebRTC DataChannel (STUN, 직접 P2P) 파일 스트리밍 ────────┘
```

- **시그널링 서버**: 기존 Fastify에 `@fastify/websocket`으로 WS 엔드포인트 추가. **인메모리 방 맵**
  (`code → { sender, receiver }`). SQLite/디스크 미사용(P2P는 아무것도 저장하지 않는다). 서버 역할은
  SDP offer/answer + ICE candidate 중계와 방 수명 관리뿐.
- **P2P 코드**: 활성 방에 대해서만 유효한 임시 6자리 코드. 인메모리이며 릴레이 코드와 별개.
  방이 닫히면(양쪽 연결 종료) 즉시 무효.
- **STUN만**: 공개 STUN 서버(예: `stun:stun.cloudflare.com:3478`)로 ICE. TURN 없음 → 대칭 NAT/
  까다로운 방화벽에서는 연결 실패할 수 있고, 그때는 릴레이로 안내한다.
- **Cloudflare Tunnel/Caddy**: WS Upgrade를 그대로 통과시킨다(둘 다 WebSocket 프록시 지원).

## 3. 시그널링 프로토콜 (WS 메시지, JSON)

- 송신자 → 서버: `{ type: 'create' }` → 서버: `{ type: 'created', code }` (유일 6자리 방 코드 발급)
- 수신자 → 서버: `{ type: 'join', code }` → 성공 시 양쪽에 `{ type: 'peer-joined' }`; 없는/사용 중
  코드면 요청자에게 `{ type: 'error', reason: 'not-found' | 'busy' }`
- 어느 쪽이든 → 서버: `{ type: 'signal', data }` → 방의 상대에게 그대로 중계(`data`는 SDP 또는 ICE)
- 소켓 종료/이탈 시 상대에게 `{ type: 'peer-left' }`, 방 정리

방 규칙: 한 방은 sender 1 + receiver 1(1:1). 이미 receiver가 있는 방에 join하면 `busy`. 송신자
소켓이 끊기면 방 삭제. 미사용 방은 TTL(예: 10분)로 청소.

## 4. WebRTC & 파일 전송 프로토콜

- `peer-joined` 시 **송신자가 offerer**: `RTCPeerConnection`(STUN 설정) + `createDataChannel` →
  `createOffer`/setLocalDescription → `signal`로 전송. 수신자는 answer, 양쪽 ICE candidate를 `signal`로
  교환. DataChannel `open` 시 전송 시작.
- **파일 프로토콜(DataChannel 메시지)**:
  - 제어(JSON 문자열): `{ kind: 'manifest', files: [{ name, size }] }`
  - 파일별: `{ kind: 'file-begin', index, name, size }` → 바이너리 청크(ArrayBuffer, ~16KB) 반복 →
    `{ kind: 'file-end', index }`
  - 전체 종료: `{ kind: 'done' }`
- **백프레셔**: `dataChannel.bufferedAmount`가 임계치(예: 4MB)를 넘으면 전송을 멈추고
  `bufferedamountlow` 이벤트에서 재개(`bufferedAmountLowThreshold` 설정). 메모리 폭주 방지.
- **수신자**: 파일별로 청크를 모아 `Blob` 생성 → 다운로드 링크 제공(또는 자동 다운로드). 진행률은
  수신 바이트/파일 크기.

## 5. UX 흐름 & 실패 처리

보내기/받기 화면에 방식 선택을 추가한다: **⚡ 실시간(P2P)** / **🔗 링크(릴레이, 기존)**.

- **보내기(P2P)**: 파일 선택 → "실시간 전송" → WS로 방 생성 → **6자리 코드 + QR을 표시하고 대기**
  (탭/창을 열어 둔 채 상대 연결을 기다림). 수신자가 연결되면 자동으로 전송 시작 + 파일별 진행률.
  완료 후 "완료" 표시.
- **받기(P2P)**: 6자리 코드 입력 → WS join → WebRTC 연결 → 수신·다운로드(진행률).
- **실패 처리**: 상대 오프라인/코드 없음(`error`), 또는 STUN으로 연결 불가/타임아웃(예: 20초 내
  DataChannel open 실패) → 명확한 메시지 + "링크(릴레이) 모드로 보내세요" 유도. P2P가 안 되는 것은
  버그가 아니라 네트워크 한계임을 안내.

## 6. 파일 구조

**백엔드(추가만, 릴레이 무변경):**
- `src/signaling.ts` — 인메모리 방 레지스트리 + 중계/정리 로직. 소켓 추상화(send/close 인터페이스)로
  받아 **단위 테스트 가능**하게 설계.
- `src/routes/ws.ts` — `@fastify/websocket` 등록, `/ws` 연결을 `signaling`에 연결.
- `src/app.ts` — 위 라우트 배선(기존 라우트/스토어와 독립).

**프론트엔드(추가 + 보내기/받기에 모드 토글):**
- `web/src/lib/signaling.ts` — WS 클라이언트(create/join/signal/이벤트).
- `web/src/lib/p2p.ts` — `RTCPeerConnection` + DataChannel 파일 송수신(청크/백프레셔/manifest 프로토콜).
- `web/src/P2PSend.tsx`, `web/src/P2PReceive.tsx` — P2P 화면.
- `web/src/SendPage.tsx` / `web/src/ReceivePage.tsx` — 방식 토글(P2P/릴레이) 추가. 기존 릴레이 UI는
  그대로.

## 7. 검증

- **단위 테스트**(vitest): `src/signaling.ts`의 방 매칭/중계/busy/peer-left/TTL 정리 로직을 가짜 소켓으로
  검증. 프론트 `p2p.ts`의 순수 부분(manifest 직렬화, 청크 분할/재조립)도 가능하면 단위 테스트.
- WebRTC 연결 자체는 단위 테스트가 어렵다 → **브라우저 2탭(동일 머신 loopback) + 실제 2기기** 수동
  검증: 로컬 및 배포 후 P2P 왕복(소용량·다중 파일), 실패 시 릴레이 안내.
- 릴레이 40+ 테스트 무변경 확인.
- WS가 Cloudflare Tunnel + Caddy를 통과하는지 배포 후 확인.

## 8. 리스크 / 주의

- STUN만이라 일부 네트워크에서 연결 실패 — 명확한 폴백 안내로 UX 확보(3단계에서 TURN/자동 폴백).
- 인메모리 방은 컨테이너 재시작 시 사라짐(진행 중 P2P 세션은 끊김) — P2P는 실시간이라 허용 가능.
- Node 컨테이너 1개이므로 WS 방은 단일 인스턴스에 상주(수평 확장은 범위 밖).
