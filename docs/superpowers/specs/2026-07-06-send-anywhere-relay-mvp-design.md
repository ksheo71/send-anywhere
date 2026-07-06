# Send Anywhere 클론 — 1단계 릴레이 MVP 설계

작성일: 2026-07-06
상태: 승인됨 (구현 계획 작성 대기)

## 1. 목적과 범위

Send Anywhere 같은 익명 파일 전송 서비스를 자가호스팅으로 만든다. 핵심 경험은
"보내는 사람이 파일을 올리면 **6자리 코드 + 공유 링크**가 나오고, 받는 사람이 그 코드나
링크로 기기에 상관없이 파일을 받는다"이다. 로그인은 없다.

전체 서비스는 3단계로 분해하며, **이 문서는 1단계(서버 릴레이 MVP)만** 다룬다.

- **1단계 (이 문서)**: 서버 릴레이만으로 완결되는 서비스. 6자리 코드 + 링크, 청크 업로드,
  24시간 만료. 배포까지 포함.
- **2단계 (향후)**: WebRTC P2P 실시간 전송 추가 (WebSocket 시그널링 + STUN + Cloudflare
  관리형 TURN).
- **3단계 (향후)**: 하이브리드 — P2P 우선 시도, 실패/오프라인 시 릴레이로 폴백.

플랫폼은 **웹 브라우저**(데스크톱/모바일)만 대상. 모바일·데스크톱 네이티브 앱은 향후 확장.

## 2. 인프라 제약 (설계를 규정하는 두 가지)

배포 대상은 맥미니 자가호스팅 인프라(`/opt/stack`)다. 트래픽 흐름은
`Cloudflare Edge → Cloudflare Tunnel → Caddy(:80) → 앱 컨테이너`이며, 여기서 두 제약이 나온다.

1. **업로드 100MB 벽**: 모든 트래픽이 Cloudflare 프록시를 지나고, 무료 플랜 요청 본문 상한이
   100MB다. 한 요청으로 대용량 파일을 올릴 수 없다. → **청크/재개 업로드(tus 프로토콜)** 필수.
   클라이언트가 파일을 50MB 조각으로 쪼개 전송한다.
2. **포트포워딩 없음 → 자체 TURN 불가**: WebRTC TURN은 UDP 포트 노출이 필요한데 이 인프라는
   포트포워딩이 없다. → P2P(2단계)는 Cloudflare 관리형 TURN에 의존해야 한다. 릴레이(1단계)는
   이 제약과 무관하므로 먼저 완결할 수 있다.

## 3. 기술 스택

- **단일 컨테이너** `send-anywhere`: Node.js + **Fastify**가 REST API와 정적 프론트엔드를 함께
  서빙한다. Node로 통일하는 이유는 2단계 WebSocket 시그널링을 같은 서버에 얹기 위함.
- **프론트엔드**: Vite + React + TypeScript. 빌드 산출물을 Fastify가 정적 서빙. 업로드는
  `tus-js-client`.
- **메타데이터 저장**: **SQLite** (`better-sqlite3`). 별도 컨테이너 없이 자기완결. blob 정리용
  스위퍼가 어차피 필요하므로 Redis의 native TTL 이점이 상쇄되어, 공용 Redis 대신 SQLite 채택.
- **파일 blob 저장**: 로컬 디스크 바인드 마운트 `/opt/stack/data/send-anywhere/uploads/`.

## 4. 데이터 모델

SQLite 스키마:

```
transfers(
  id            TEXT PRIMARY KEY,   -- uuid
  code          TEXT UNIQUE,        -- 6자리 숫자 코드
  slug          TEXT UNIQUE,        -- 링크용 긴 랜덤 토큰(추측 불가)
  created_at    INTEGER,            -- epoch ms
  expires_at    INTEGER,            -- epoch ms (created_at + RETENTION_HOURS)
  download_count INTEGER DEFAULT 0,
  status        TEXT                -- 'uploading' | 'ready' | 'expired'
)

files(
  id              TEXT PRIMARY KEY, -- uuid
  transfer_id     TEXT,             -- FK -> transfers.id
  filename        TEXT,
  size            INTEGER,
  stored_path     TEXT,             -- uploads/{transferId}/{fileId}
  upload_complete INTEGER DEFAULT 0
)
```

디스크 레이아웃: `uploads/{transferId}/{fileId}` (tus 파일 스토어가 기록).

**두 종류의 키**:
- **6자리 숫자 코드**: 사람이 손으로 입력하는 편의용. 1M 조합이라 브루트포스 방어 필요(§7).
- **긴 랜덤 slug**: 공유 링크용. 추측 불가하므로 링크 자체는 안전.
- 둘 다 같은 transfer를 가리킨다.

## 5. 업로드 메커니즘 & API

업로드는 **tus 프로토콜**로 100MB 벽을 우회한다. 클라이언트가 파일을 `CHUNK_SIZE`(기본 50MB)
조각으로 쪼개 `PATCH`를 반복하며, 중단 시 `HEAD`로 오프셋을 확인해 이어받는다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/transfers` | 파일 목록(이름/크기)으로 세션 생성. `transferId` + 6자리 코드 + slug + 파일별 tus 업로드 URL 반환 |
| POST/PATCH/HEAD | `/files/*` | tus 청크 업로드 엔드포인트(`@tus/server` + `@tus/file-store`) |
| POST | `/api/transfers/:id/finalize` | 모든 파일 업로드 완료 표시 → `status=ready` |
| GET | `/api/resolve/:codeOrSlug` | 받는 사람 UI용 메타데이터(파일명/크기 목록, 만료시각) 조회 |
| GET | `/api/transfers/:id/download` | 다운로드 스트리밍. 파일 1개는 그대로, 여러 개는 zip 스트림. 완료 시 `download_count` 증가 |
| GET | `/api/health` | 헬스체크 (인프라 요구사항) |

## 6. UX 흐름

**보내기**: 파일 드롭/선택 → 청크 업로드 진행률(파일별/전체) 표시 → 완료 시 **6자리 코드 + QR
코드 + 복사 가능한 링크** 노출.

**받기**: 공유 링크로 진입하거나 6자리 코드 입력 → 파일 목록·크기·만료시각 확인 → 다운로드
(여러 개면 "전체 zip 받기" + 개별 받기 버튼).

## 7. 보안 · 만료 · 정리

- **만료 정책**: 기본 24시간(`RETENTION_HOURS`). **24시간 동안 횟수 제한 없이 여러 번 다운로드
  가능**. 다운로드 후 삭제하지 않음. `download_count`는 통계용으로만 증가.
- **스위퍼**: 컨테이너 내부 주기 작업(기본 10분마다)이 `expires_at`이 지난 transfer의 blob과
  레코드를 삭제하고 `status=expired` 처리.
- **6자리 브루트포스 방어**: `/api/resolve/:code` 조회에 IP당 rate limit(`@fastify/rate-limit`).
  짧은 TTL(24h)과 결합해 대량 추측을 막는다. 링크(slug)는 추측 불가라 rate limit 대상 아님.
- **용량 제한**: 서버측에서 파일당(`MAX_FILE_SIZE`)·총합(`MAX_TOTAL_SIZE`) 크기 강제. 세션 생성
  시 디스크 여유 공간 확인 후 부족하면 신규 거부.

**설정값 (전부 env, 기본값)**:

| 변수 | 기본값 | 의미 |
|---|---|---|
| `RETENTION_HOURS` | 24 | 보관 시간 |
| `MAX_FILE_SIZE` | 2GB | 파일당 상한 |
| `MAX_TOTAL_SIZE` | 4GB | 한 전송의 총합 상한 |
| `CHUNK_SIZE` | 50MB | 클라이언트 청크 크기(100MB 벽 아래) |
| `CODE_LENGTH` | 6 | 숫자 코드 길이 |
| `STORAGE_PATH` | `/data/uploads` | blob 저장 경로(컨테이너 내부) |
| `SWEEP_INTERVAL_MIN` | 10 | 스위퍼 주기 |
| `RATE_LIMIT` | 분당 30 | 코드 조회 IP당 상한 |
| `PORT` | 4500 | 컨테이너 리슨 포트 |

## 8. 배포

맥미니 인프라(`/opt/stack`) 표준 패턴을 그대로 따른다.

- repo에 `Dockerfile` + `docker-compose.yml`(고유 `name:`, `edge_shared` external 합류) +
  `scripts/deploy.sh` + `.github/workflows/deploy.yml`.
- 컨테이너명 `send-anywhere`, 리슨 포트 4500(기존 앱과 충돌 없는 값). 호스트 포트 외부 노출 안 함.
- 바인드 마운트: 호스트 `/opt/stack/data/send-anywhere/uploads` → 컨테이너 `/data/uploads`,
  SQLite 파일도 `/opt/stack/data/send-anywhere/db/` 아래 영속화.
- `/api/health` 제공(`deploy.sh` 헬스체크용).
- Caddyfile 1줄 추가:
  ```
  http://send.myazit.kr {
      import common
      reverse_proxy send-anywhere:4500
  }
  ```
- `*.myazit.kr` 와일드카드가 서브도메인을 흡수하므로 Cloudflare 대시보드 작업 불필요.
- `.gitignore`에 `.env*` 포함, 시크릿은 운영 트리 `.env`에만.

## 9. 테스트

- **단위**: 6자리 코드/slug 생성·충돌 재시도, 만료시각 계산, 스위퍼 삭제 조건, 용량 제한 판정.
- **통합**: tus 청크 업로드 → finalize → resolve → 다운로드 → 만료 스위핑까지 전체 경로,
  중단 후 이어받기(resume), 만료·존재하지 않는 코드 404, rate limit 동작, 다중 파일 zip 다운로드.

## 10. 범위에서 제외 (1단계 아님)

- WebRTC P2P 실시간 전송 (2단계)
- Cloudflare TURN 연동 (2단계)
- P2P↔릴레이 하이브리드 폴백 (3단계)
- 로그인/계정, 전송 이력, 연락처 (익명 유지)
- 모바일/데스크톱 네이티브 앱
