# SBSB DB 자동 설정 테스트 앱

SBSB의 온프레미스 DB 자동 설정을 확인하기 위한 Node.js 앱입니다.

- 방문할 때마다 방문 수를 **Postgres**에 기록하고, 직전 방문 버전을 **Redis**에 저장합니다.
- 재배포하거나 롤백해도 숫자가 이어지면 "DB는 고정 컨테이너, 앱만 교체" 구조가 동작하는 것입니다.

## 일부러 빠져 있는 것

- **`Dockerfile`**: SBSB가 AI로 만들어 설정 PR에 넣습니다.
- **`compose.yaml`**: SBSB는 `package.json`의 `pg`, `redis` 의존성을 보고 DB가 필요한 앱임을 알아냅니다. 그다음 DB용 compose를 서버에만 만들어 띄웁니다. 이 저장소에는 넣지 않습니다.
- **DB 비밀번호**: SBSB가 무작위로 만들어 암호화 저장하고, 배포할 때 앱에 넣어 줍니다. 저장소에는 들어가지 않습니다.

## 앱이 하는 일

| 경로 | 내용 |
|------|------|
| `/` | 방문 수 +1 (Postgres), 직전 방문 버전 표시 (Redis), 받은 연결 변수 ✓/✗ 표시 |
| `/api/status` | 같은 정보를 JSON으로 보여 줍니다. 방문으로 세지 않습니다 |

- SBSB 온프레미스 화면의 기본 컨테이너 포트에 맞춰 **8000번**에서 실행됩니다 (`PORT`로 바꿀 수 있음).
- 테이블은 앱이 시작할 때 직접 만듭니다 (`CREATE TABLE IF NOT EXISTS`). SBSB는 마이그레이션을 실행하지 않습니다.
- SBSB의 배포 점검 요청(`wget`)은 방문 수에 넣지 않습니다.
- 연결 변수는 있는지 없는지만 표시합니다. 비밀번호 같은 값은 화면에 나오지 않습니다.
- 응답 헤더 `X-App-Version`에 버전이 들어갑니다.

## 테스트 시나리오

### 0. 준비
1. 이 폴더를 새 GitHub 저장소로 올립니다.
2. SBSB에서 GitHub App을 그 저장소에 설치하고 저장소를 고릅니다.
3. **저장소 분석**을 실행합니다. 온프레미스 탭의 "데이터베이스 자동 설정"에 **PostgreSQL**과 **Redis**가 보여야 합니다.
4. Dockerfile 생성 → 설정 PR → 머지 → GitHub Actions 빌드까지 진행합니다.
5. 배포 서버에서 SBSB의 "원클릭 설정 명령어"를 실행합니다. 이 명령이 Docker Compose도 설치합니다.
6. 서버를 등록합니다. 컨테이너 포트는 **8000**입니다.

### 1. 첫 배포: DB 생성
- **배포 로그**
  - `Creating database containers (data is stored in named volumes)...`
  - `Database containers are ready.`
- **페이지**: 방문 수 1, Redis `연결됨`. 받은 연결 변수 `DATABASE_URL`, `REDIS_URL`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`이 모두 ✓
- **서버에서 확인**
  ```bash
  docker ps --filter label=sbsb.app          # sbsb-data-<id>-db-1, sbsb-data-<id>-cache-1 (healthy)
  docker volume ls | grep sbsb-data          # ..._pgdata, ..._redisdata
  docker port sbsb-data-<id>-db-1            # 출력 없음 = DB 포트가 바깥에 열려 있지 않음
  ```

### 2. 재배포: 데이터 유지 + 무중단 교체
1. `server.js`의 `VERSION`을 `"v2"`로, `COLOR`를 다른 색(예: `"#2f9e44"`)으로 바꿔 push합니다.
2. 빌드가 끝나면 다시 배포합니다.
- **배포 로그**: `Database containers already exist: only changed settings are applied, data is kept.`
- **페이지**: 방문 수가 이어지고, 직전 방문 버전에 `v1`이 보입니다. 배경색과 버전이 바뀝니다.
- **서버에서 확인**: DB 컨테이너의 시작 시각(`docker ps`의 `STATUS`)이 바뀌지 않았으면 DB를 다시 만들지 않은 것입니다.

### 3. 롤백
배포 이력에서 v1 배포를 되돌립니다.
- **페이지**: v1 화면으로 돌아가고, 방문 수는 계속 이어집니다 (DB는 되돌아가지 않음).

### 4. 사용자 환경변수
1. 온프레미스 탭의 "앱 환경변수"에 `API_KEY`(값은 아무거나)를 추가합니다.
2. 다시 배포합니다.
- **페이지**: `API_KEY 설정됨`

### 5. 비밀번호 보기
"데이터베이스 자동 설정"에서 PostgreSQL의 **비밀번호 보기**를 누릅니다. 서버에서 그 비밀번호로 접속되는지 확인합니다.
```bash
docker exec -it sbsb-data-<id>-db-1 psql -U app app -c "SELECT count(*) FROM visits"
```

### 6. 외부 DB 사용 (선택)
1. "앱 환경변수"에 `DATABASE_URL`을 직접 넣습니다.
   - DB 패널의 PostgreSQL 옆에 "직접 넣은 환경변수를 사용 (자동 생성 안 함)"이 표시됩니다.
   - 다음 배포부터는 Postgres를 띄우지 않고 Redis만 띄웁니다.
2. 넣은 주소가 서버에서 닿지 않으면 앱이 시작하지 못해 배포가 실패합니다. 이때 기존 버전은 그대로 유지되어야 합니다.
3. 원래대로 돌리려면 `DATABASE_URL`을 삭제하고 다시 배포합니다.

### 7. 서버 삭제 + DB 데이터 삭제
1. 서버 **삭제** 버튼을 누릅니다.
2. 두 번째 확인창의 선택에 따라 결과가 달라집니다.
   - **확인**: 서버에서 `docker ps --filter label=sbsb.app`와 `docker volume ls | grep sbsb-data`의 결과가 모두 비어 있어야 합니다.
   - **취소**: DB 컨테이너와 볼륨이 그대로 남아야 합니다.

## 다른 DB로 테스트하려면

`package.json`의 의존성만 바꾸면 감지되는 DB가 바뀝니다. 바꾼 뒤 **저장소 분석을 다시 실행**하세요.

| 의존성 | 감지되는 DB | 앱이 받는 변수 |
|--------|-------------|----------------|
| `mysql2` | MySQL | `MYSQL_URL`, `DATABASE_URL`, `DB_*` |
| `mongodb`, `mongoose` | MongoDB | `MONGODB_URI` |

다만 이 앱의 코드는 Postgres와 Redis 기준이라, 화면까지 확인하려면 `server.js`도 그 DB에 맞게 고쳐야 합니다.
