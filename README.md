# send-anywhere

Send Anywhere 클론 — tus 기반 이력형 업로드, 6자리 코드 공유, 만료 스위핑을 지원하는 파일 전송 서비스.

## 로컬 실행

```bash
npm install
npm run build   # dist/(서버) + web/dist(프론트) 빌드
STORAGE_PATH=./data/uploads DB_PATH=./data/db/x.sqlite npm start
```

개발 중에는 서버/프론트를 각각 watch 모드로 띄울 수 있다.

```bash
npm run dev:server   # tsx watch, :4500
npm run dev:web      # vite dev server, /api·/files는 :4500으로 프록시
```

테스트:

```bash
npm test
```

## 배포 (맥미니 / OrbStack)

트래픽 경로: `Cloudflare Tunnel → Caddy(:80) → send-anywhere 컨테이너 (edge_shared 네트워크, :4500)`.

배포는 `git push origin main` → 맥미니의 self-hosted GitHub Actions 러너가 `scripts/deploy.sh` 실행 → `docker compose up --build --force-recreate` → `/api/health` 헬스체크 순으로 진행된다.

### 최초 배포 (한 번만)

1. 운영 트리 생성:
   ```bash
   mkdir -p /opt/stack/services/public/myazit.kr/send-anywhere
   cd /opt/stack/services/public/myazit.kr/send-anywhere
   git clone <repo-url> repo
   ```
2. `.env` 작성 (운영 트리 상위 디렉토리, `repo/`와 같은 레벨). `.env.example`을 참고해 채우고 권한을 제한한다.
   ```bash
   cp repo/.env.example .env
   chmod 600 .env
   ```
3. 데이터 볼륨 디렉토리 준비:
   ```bash
   mkdir -p /opt/stack/data/send-anywhere/uploads /opt/stack/data/send-anywhere/db
   ```
4. 이 앱 전용 self-hosted GitHub Actions 러너를 등록한다 (`runs-on: self-hosted`로 매칭되도록).
5. GitHub에서 이 저장소를 pull할 수 있도록 deploy key를 등록하고, 맥미니의 `~/.ssh/config`에 별칭을 추가한다.
6. `edge_shared` 네트워크가 이미 있어야 한다 (Caddy 등 다른 서비스와 공유하는 external 네트워크).

이후에는 `main`에 push하면 CI(`.github/workflows/deploy.yml`)가 `scripts/deploy.sh`를 실행해 자동 배포된다.

### Caddy 라우트 추가

`edge-caddy` 레포의 Caddyfile에 아래 한 줄을 추가하고 push한다.

```
http://send.myazit.kr {
    import common
    reverse_proxy send-anywhere:4500
}
```

`*.myazit.kr` 와일드카드가 서브도메인을 이미 흡수하므로 Cloudflare 대시보드 작업은 별도로 필요 없다.

### 수동 배포/헬스체크

```bash
/opt/stack/services/public/myazit.kr/send-anywhere/repo/scripts/deploy.sh
```

컨테이너 헬스체크는 `docker exec send-anywhere wget -q --spider http://localhost:4500/api/health`로 확인한다 (최대 60초 재시도).

## 로컬 Docker 빌드 스모크 테스트

레포 루트에서:

```bash
docker build -t send-anywhere-test -f Dockerfile .
```

(운영 트리의 `docker-compose.yml`은 `build.context: ./repo` 기준이므로, 레포 안에서 직접 `docker compose`로 로컬 테스트하려면 `context: .`로 바꿔서 써야 한다.)

## 환경 변수

`.env.example` 참고. 컨테이너는 `STORAGE_PATH`, `DB_PATH` 경로에 볼륨이 마운트된다 (`/data/uploads`, `/data/db`).
