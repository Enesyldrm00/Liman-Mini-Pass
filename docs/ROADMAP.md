# Liman — Mini PaaS · Yol Haritası

> **Tek cümle:** `git push` edildiğinde imajı kendiliğinden build edip deploy eden ve uygulamayı kendi subdomain'inde yayına alan, kendi sunucunda çalışan küçük bir Vercel/Railway.
>
> **Repo**: Enesyldrm00/Liman-Mini-Pass · **Ana dil:** TypeScript · **Kategori:** DevOps + Backend
> **Belge sürümü:** v2

---

## v1 → v2: Ne değişti?

- **OAuth App yerine GitHub App.** Uygulama başına webhook kaydı yok, kullanıcı token'ı saklanmıyor, kısa ömürlü installation token'ları ve minimum yetki var.
- **Durum geçişlerinin sahipliği netleşti.** API build'i oluşturur ve kuyruktakini iptal eder; geri kalan her geçiş worker'ındır. Yarış senaryoları tek tek yazıldı.
- **Build ve deployment durumları ayrıldı.** Rollback "herhangi bir başarılı build'i yeniden deploy et" oldu; env değişince yeniden deploy da aynı yoldan gider.
- **Uygulama Sözleşmesi eklendi.** Kullanıcının reposundan neler beklendiği tanımlı.
- **Faz 1 trafik geçişi açıkça tanımlandı:** Traefik file provider. Lokal webhook için smee.io eklendi.
- **Canlı log akışında sıralama garantisi tanımlandı:** önce DB'ye yaz, sonra yayınla; önce abone ol, sonra oku.
- **`Builder` ve `Deployer` arayüzleri Faz 1'den başlıyor.** Böylece akış sahte implementasyonlarla test edilebiliyor.
- **Faz 2'ye somut detaylar eklendi:** registry'nin node ve pod tarafından farklı çözülmesi, user namespaces ile Buildah, build namespace'i için NetworkPolicy, quota hesabı, HPA ile server-side apply çakışması.
- **Faz 3:** Liman'ın kendi imajları GHCR'de duruyor, self-deploy SSH ile, bellek bütçesi var.
- **Faz 4:** VPS 8 GB, k3s Secret şifreleme, yedekten geri yükleme testi.
- **Commit kuralı yeniden yazıldı:** tarih oynatma yok. Issue → dal → PR akışı ve oturum başına bir alt bölüm ritmi (Bölüm 16).
- **Kodun tamamını Claude Code yazar.** PR'lar CI yeşilse merge edilir; kontrol soruları ve Türkçe özet anlamaya yardımcıdır, merge'i engellemez.

---

## İçindekiler

0. Bu dosya nasıl kullanılır
1. Ürün tanımı
2. Kapsam
3. Uygulama Sözleşmesi
4. Teknoloji yığını
5. Mimari
6. Dizin yapısı
7. Veri modeli
8. Durum makineleri ve eşzamanlılık
9. Kuyruk ve worker tasarımı
10. API yüzeyi
11. Canlı log akışı
12. Fazlar (0–4)
13. Güvenlik
14. Test stratejisi
15. Ortam değişkenleri
16. Git iş akışı ve commit geçmişi
17. ADR listesi
18. Ölçüm ve README
19. Diğer projelerle bağlantı
20. Tuzaklar
Ek — Yeni sohbet için bağlam

---

## 0. Bu dosya nasıl kullanılır

- Bu dosya projenin **tek doğruluk kaynağıdır**. Repoda `docs/ROADMAP.md` olarak durur.
- Öncelik sırası: **ROADMAP > ADR'ler > kod yorumları.** Çelişki görülürse kod yazılmaz, Enes'e sorulur.
- Repo kökündeki `CLAUDE.md` Claude Code'un çalışma kurallarını içerir; ayrı dosya olarak verilmiştir. İçeriği özetle şudur:
  - İşe başlamadan bu dosyayı ve `docs/NOTES.md`'yi oku, son commit'lere bak, kalınan yeri Enes'e teyit ettir.
  - Fazlar sırayla uygulanır; "Bitti tanımı" sağlanmadan sonraki faza geçilmez.
  - Kapsam Bölüm 2'dedir; "Yok" listesindeki hiçbir şey eklenmez.
  - Bir oturumda en fazla bir alt bölüm yapılır. Kodun tamamını Claude Code yazar; CI yeşilse PR merge edilir.
  - Git kuralları Bölüm 16'dadır. Commit tarihleri ve geçmiş değiştirilmez.
  - Kod, yorumlar, README ve commit mesajları İngilizce; ADR'ler ve NOTES.md Türkçe.
  - Testi olmayan özellik bitmiş sayılmaz. `.env` repoya girmez; `.env.example` güncel tutulur.

---

## 1. Ürün Tanımı

**Problem:** Bir Node.js/Python projesini yayına almak için VPS'e SSH ile girip bağımlılık kurmak, servisi başlatmak, reverse proxy ve SSL ayarlamak gerekiyor. Her kod değişikliğinde aynı döngü tekrar ediyor.

**Çözüm:** Kullanıcı Liman'ın GitHub App'ini reposuna kurar ve panelden uygulamayı tanımlar. Repoya her push geldiğinde Liman imajı üretir, kendi registry'sine koyar, sağlık kontrolünden geçirerek deploy eder ve `uygulama.alanadi.com` adresinde yayına alır.

### Kullanıcı akışı

1. **GitHub ile giriş yap.** Yalnızca izinli GitHub kullanıcıları girebilir.
2. **İlk seferde Liman GitHub App'ini kur.** Hangi repolara erişileceğini GitHub'ın ekranında sen seçersin.
3. **"Yeni uygulama"** → repo → dal → subdomain → port → sağlık yolu (varsayılan `/`).
4. **Ortam değişkenlerini gir.**
5. **İlk deploy:** "Şimdi deploy et" butonu (dalın son commit'i) ya da push.
6. **Build logunu panelde canlı izle.**
7. **Uygulama yayında.** Deploy geçmişini gör; herhangi bir başarılı build'e tek tıkla dön. Env değiştiyse "Yeniden deploy et".

### Terimler

| Terim | Anlamı |
|---|---|
| **Build** | Bir commit için clone → imaj build → registry'ye push → deploy hattı |
| **Deployment** | Belirli bir imajın belirli bir env ile çalıştırılma denemesi. Build'den doğabilir ya da rollback/redeploy ile doğabilir |
| **Aktif deployment** | Şu an trafiği alan deployment. Uygulama başına en fazla bir tane |
| **Installation** | GitHub App'in bir hesaba ve seçili repolara kurulumu |
| **Delivery** | GitHub'ın tek bir webhook gönderimi (`X-GitHub-Delivery` ile tekil) |

---

## 2. Kapsam

**Var:**
- Kökünde `Dockerfile` bulunan repolar
- Tek port dinleyen HTTP servisleri
- Ortam değişkenleri: şifreli saklanır, yalnızca **çalışma zamanında** verilir
- Deploy geçmişi, rollback ve redeploy
- Canlı build logu
- Tek sahip (sen). Veri modeli çok kullanıcıyı destekler ama **public kayıt kapalı**

**Yok (eklenmeyecek):**
- Buildpack / otomatik dil tespiti
- Yönetilen veritabanı sunma
- Faturalama, takım/davet sistemi
- Özel domain bağlama (yalnızca subdomain)
- Birden fazla port veya TCP/UDP servis
- Build zamanı sırları (build args ile secret geçirme)

**Park alanı** (fikir olarak duruyor; Enes onaylamadan yapılmaz):
- GitHub Checks / commit status ile deploy durumunu GitHub'da göstermek
- Build cache (katman önbelleği)
- PR başına önizleme deployment'ı
- Panelden subdomain değiştirme

**Bilinçli olarak kabul edilen sınırlamalar** (ADR'lerde yazılır):
- Faz 1'de uygulamalar Docker ağı üzerinden birbirine erişebilir. Faz 2'de NetworkPolicy ile kapanır.
- Faz 1'de worker host Docker socket'ine erişir, yani host'ta root eşdeğeri yetkisi vardır. Faz 2'de kalkar.
- Tek node. Yüksek erişilebilirlik hedeflenmiyor.
- Build cache yok; her build sıfırdan yapılır.
- Rollback imajı geri alır, **env'i geri almaz**. Her deploy o anki env ile yapılır.

---

## 3. Uygulama Sözleşmesi

Liman'a deploy edilecek bir reponun uyması gereken kurallar. README'de de yer alır.

| Kural | Neden |
|---|---|
| Kökte `Dockerfile` var | Buildpack yok |
| Uygulama `0.0.0.0:<port>` adresinde dinler (`127.0.0.1` değil) | Aksi hâlde konteyner dışından erişilemez. **En sık hata budur.** |
| `PORT` ortam değişkeni Liman tarafından verilir ve uygulamada tanımlanan porta eşittir | Uygulama portu koda gömmek zorunda kalmasın |
| Sağlık yolu (varsayılan `/`) hazır olduğunda 200–399 döner | Trafik ancak sağlıklı sürüme çevrilir |
| `SIGTERM` gelince 25 saniye içinde düzgün kapanır | Kesintisiz geçiş için |
| Durumsuzdur; konteyner diski geçicidir | Yeniden başlatmada veri kaybolur |
| Sırlar build sırasında gerekmez | Env yalnızca çalışma zamanında verilir |
| Bellek 256 MB, CPU 0.5 çekirdek varsayılan tavanına sığar | Kaynak limitleri |

---

## 4. Teknoloji Yığını

| Katman | Seçim | Gerekçe |
|---|---|---|
| Çalışma ortamı | Node.js güncel Active LTS (`.nvmrc`, `engines` ve `packageManager` ile sabitlenir) | Tekrar üretilebilir ortam |
| API | TypeScript + **Express 5** + **Zod** | Express 5 async hataları kendisi yakalar; Zod şemaları `shared` paketinde ortak |
| Loglama | pino (JSON, istek kimliği ile) | Yapısal log; Faz 3'te Loki'de sorgulanabilir |
| ORM / migration | Drizzle + drizzle-kit | SQL'e yakın, şema kod içinde |
| Veritabanı | PostgreSQL (17+) | Gerçeğin kaynağı |
| Kuyruk | Redis + BullMQ | Build uzun süren bir iş; HTTP isteğinin içinde yapılmaz |
| Log akışı | Redis Pub/Sub → **SSE** | Tek yönlü akış; WebSocket gerekmez (ADR-0007) |
| GitHub entegrasyonu | **GitHub App** + Octokit | Minimum yetki, tek merkezi webhook, kısa ömürlü token (ADR-0002) |
| Lokal webhook tüneli | smee.io | GitHub localhost'a istek atamaz; GitHub'ın kendi dokümantasyonunda önerilen araç |
| Build (Faz 1) | Docker CLI (host socket) | Hızlı başlangıç; riski ADR-0006'da |
| Build (Faz 2) | **Buildah**, K8s Job içinde, user namespace ile | Daemonsız; Kaniko Haziran 2025'te arşivlendi (ADR-0012) |
| Registry | CNCF Distribution (`registry:2`/`registry:3`) | Kullanıcı uygulamalarının imajları |
| Liman'ın kendi imajları | GHCR | Liman kendi registry'sine bağımlı olmasın; tavuk-yumurta problemi |
| Orkestrasyon | Docker (Faz 1) → **k3s** 1.36+ (Faz 2) | Önce ihtiyacı hisset, sonra K8s'e devret |
| Ingress / proxy | Traefik v3 | k3s ile gelir. Faz 1'de Liman servisleri için Docker provider, uygulamalar için file provider |
| K8s istemcisi | `@kubernetes/client-node` | Resmi JS istemcisi |
| Panel | React + Vite + TanStack Query + Tailwind | Sade araç arayüzü |
| Test | Vitest, Testcontainers, k6 | Bölüm 14 |
| Gözlemlenebilirlik | prom-client, Prometheus, Grafana, Loki, **Grafana Alloy** | Promtail Mart 2026'da kullanım ömrünü tamamladı |
| TLS (Faz 4) | cert-manager + DNS-01 | Wildcard sertifika |
| CI/CD | GitHub Actions | Lint, test, imaj, self-deploy |
| Paketleme | Helm | Faz 3 |
| Monorepo | pnpm workspaces | |

---

## 5. Mimari

```
                    ┌─────────────────────────────── Liman ───────────────────────────────┐
 GitHub App ─push──►│  API (Express)                                                      │
 (webhook)          │   • HMAC doğrulama + delivery tekilleştirme                         │
                    │   • oturum, uygulama ve env yönetimi                                │
                    │   • build kaydı (queued) + kuyruğa iş   • SSE ile log               │
                    └──────┬────────────────────┬──────────────────────────▲──────────────┘
                           │ SQL                │ iş / iptal bayrağı       │ Pub/Sub (log)
                           ▼                    ▼                          │
                     PostgreSQL           Redis (BullMQ + Pub/Sub)         │
                     (gerçeğin kaynağı)         │                          │
                           ▲                    ▼                          │
                           │        ┌──────────────────────────────────────┴───┐
                           └────────│  Worker                                  │
                                    │   claim → clone → build → push → deploy  │
                                    │   heartbeat · iptal · zaman aşımı        │
                                    └──────┬──────────────────────┬────────────┘
                                           │ Builder              │ Deployer
                              F1: docker CLI           F1: Docker + Traefik file provider
                              F2: Buildah Job          F2: K8s API (Deployment, Service, Ingress…)
                                           │                      │
                                           ▼                      ▼
                                       Registry ──── pull ───► Uygulama konteynerleri
                                                                  ▲
                         tarayıcı ──► Traefik ── <sub>.alanadi.com ┘
                                         └────── liman.alanadi.com ──► Panel (statik) + /api ──► API
```

### Sorumluluk ayrımı

| Bileşen | Yapar | Yapmaz |
|---|---|---|
| **API** | Kimlik, uygulama/env yönetimi, webhook kabulü, `queued` build oluşturma, kuyruktaki build'i iptal etme, iptal bayrağı yazma, SSE | Uzun iş (clone, build, deploy) |
| **Worker** | Build durum makinesinin geri kalan tüm geçişleri, deploy, temizlik işleri, reaper ve reconcile | HTTP isteği karşılamak (yalnızca Faz 3'te `/metrics`) |
| **PostgreSQL** | Kalıcı durum. Her kararın dayanağı | — |
| **Redis** | Kuyruk, Pub/Sub, iptal bayrakları | Gerçeğin kaynağı olmak. Redis kaybolsa da DB'den toparlanılır (Bölüm 9) |

### Alan adları

| | Geliştirme | Üretim |
|---|---|---|
| Panel + API | `liman.localhost` (API `/api` altında) | `liman.alanadi.com` |
| Uygulamalar | `<sub>.localhost` | `<sub>.alanadi.com` |
| Traefik paneli | yalnızca `127.0.0.1:8080` | dışarı açık değil |
| Registry | `localhost:5000` | dışarı açık değil |

Panel ile API **aynı origin**'dedir. Bu sayede CORS gerekmez ve EventSource çerezleri sorunsuz taşır.

> Not: Tarayıcılar `*.localhost` adresini kendiliğinden 127.0.0.1'e çözer. Başka araçlar (Node, bazı curl sürümleri) çözmeyebilir; gerekirse hosts dosyası kullanılır.

### Faz 1 ağ topolojisi (Docker)

- `liman-internal`: postgres, redis, registry, api, worker, web, traefik
- `liman-apps`: kullanıcı uygulamaları, traefik, worker (sağlık kontrolü için)
- Uygulamalar `liman-internal`'a erişemez. Birbirlerine erişebilirler; bu bilinen bir sınırlamadır.

---

## 6. Dizin Yapısı

```
liman/
├── apps/
│   ├── api/              # Express API, webhook, SSE
│   │   └── src/{routes,services,middleware,github,sse,config}
│   ├── worker/           # BullMQ işleyicisi, pipeline, reaper, reconcile
│   │   └── src/{pipeline,builders,deployers,logs,jobs,config}
│   └── web/              # React panel
├── packages/
│   └── shared/           # Zod şemaları, tipler, durum sabitleri, doğrulayıcılar
├── infra/
│   ├── compose/          # Yerel geliştirme (Faz 0–1)
│   ├── traefik/          # Statik yapılandırma, dinamik dosyalar dizini (Faz 1)
│   ├── k8s/              # Ham manifestler (Faz 2)
│   ├── helm/liman/       # Helm chart (Faz 3)
│   └── grafana/          # Dashboard JSON (Faz 3)
├── scripts/              # e2e, ölçüm, yük testi (k6) betikleri
├── docs/
│   ├── ROADMAP.md        # bu dosya
│   ├── NOTES.md          # faz özetleri (mülakat hazırlığı)
│   ├── github-app-setup.md
│   ├── runbooks/         # geri yükleme, anahtar rotasyonu, disk dolu… (Faz 4)
│   └── adr/
├── .github/
│   ├── workflows/
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
├── CLAUDE.md
├── CHANGELOG.md
└── README.md
```

Örnek uygulama ayrı bir repodadır: **`liman-sample-app`** (Bölüm 14).

---

## 7. Veri Modeli

Bütün `id` alanları UUID'dir. Zaman alanları `timestamptz` tipindedir.

| Tablo | Alanlar | Kısıtlar / indeksler |
|---|---|---|
| `users` | id, github_id (bigint), login, avatar_url, created_at, last_login_at | `github_id` unique |
| `sessions` | id, user_id → users, token_hash, created_at, expires_at, last_seen_at | `token_hash` unique · user silinince cascade |
| `github_installations` | id, installation_id (bigint), owner_id → users, account_login, account_type, suspended_at, created_at | `installation_id` unique |
| `apps` | id, owner_id → users, installation_ref → github_installations, name, subdomain, repo_id (bigint), repo_full_name, branch, port, health_path, status (`active`/`deleting`), created_at, updated_at | `subdomain` unique · index (repo_id, branch) |
| `env_vars` | id, app_id → apps, key, value_enc, updated_at | (app_id, key) unique · cascade |
| `builds` | id, app_id → apps, trigger (`push`/`manual`), commit_sha, commit_message, commit_author, delivery_id, status, failed_stage, error_message, image_ref, queued_at, started_at, finished_at, heartbeat_at | index (app_id, queued_at desc) · aktif durumlar için kısmi index · cascade |
| `build_logs` | build_id → builds, seq, stream (`stdout`/`stderr`/`system`), line, ts | PK (build_id, seq) · cascade |
| `deployments` | id, app_id → apps, build_id → builds, kind (`build`/`rollback`/`redeploy`), status, image_ref, error_message, created_at, finished_at | **kısmi unique: (app_id) WHERE status = 'active'** · index (app_id, created_at desc) |
| `webhook_deliveries` | delivery_id (PK), event, received_at | 7 günden eski kayıtlar temizlenir |

### Kurallar

- **`repo_id` saklanır, `repo_full_name` sadece gösterim içindir.** Repo yeniden adlandırılsa da eşleşme bozulmaz.
- **`image_ref` digest içerir** (`…/app-<id>@sha256:…`). Deploy etiketle değil digest ile yapılır, çünkü etiket değişebilir, digest değişmez.
- **"Aktif deployment en fazla bir tane" kuralını veritabanı garanti eder** (kısmi unique index). Koddaki bir hata bu kuralı bozamaz.
- **Oturum token'ı DB'de düz değil SHA-256 özeti olarak tutulur.** DB sızsa bile oturum çalınamaz.
- **Kullanıcı GitHub token'ı saklanmaz.** Repo erişimi installation token ile yapılır.

### Şifreleme

- `env_vars.value_enc`, AES-256-GCM ile uygulama seviyesinde şifrelenir.
- Her değer için rastgele 12 baytlık nonce kullanılır. Saklama biçimi sürüm önekiyle başlar (`v1:` + nonce + şifreli metin + etiket); bu, ileride anahtar rotasyonunu mümkün kılar.
- **Ek doğrulama verisi (AAD) = `app_id:key`.** Şifreli bir değer başka bir satıra kopyalanırsa çözülemez.
- Anahtar `LIMAN_ENCRYPTION_KEY` ortam değişkeninden gelir (32 bayt, base64). Kaybolursa env değerleri de kaybolur; bu yüzden repo dışında yedeklenir (Faz 4).

### Env değişkeni kuralları

- Anahtar biçimi: büyük harf, rakam ve alt çizgi; rakamla başlamaz.
- Rezerve anahtarlar: `PORT` ve `LIMAN_` ile başlayanlar.
- En fazla 100 değişken; değer başına en fazla 32 KB.

---

## 8. Durum Makineleri ve Eşzamanlılık

### Build

```
queued ──► cloning ──► building ──► pushing ──► deploying ──► succeeded
   │          │           │            │             │
   │          └───────────┴────────────┴─────────────┴──────► failed  (failed_stage alanı ile)
   └──────────┴───────────┴────────────┴────────────────────► cancelled
```

- `deploying` aşamasındaki build **iptal edilemez**; tamamlanır. Trafik geçişinin yarısında durmak, yarım kalmış bir durum bırakır.
- `succeeded` "bu build deploy edildi" demektir. "Şu an yayında" bilgisi `deployments.status = 'active'` alanından okunur.

### Deployment

```
pending ──► active ──► superseded
   └──────► failed
```

### Uygulama

```
active ──► deleting ──► (satırlar silinir)
```

### Geçiş sahipliği

Her geçiş tek bir koşullu güncellemedir: durum, ancak beklenen durumdaysa değişir. **Etkilenen satır sayısı 0 ise geçiş başarısızdır** ve çağıran taraf buna göre davranır. Bu mekanizma yarışların kazananını belirler; kilit gerekmez.

| Geçiş | Yapan | Koşul |
|---|---|---|
| — → `queued` | API (webhook veya manuel tetikleme) | ekleme |
| `queued` → `cancelled` | API veya worker | durum `queued` ise |
| `queued` → `cloning` (claim) | Worker | durum `queued` ise |
| `cloning` → `building` → `pushing` → `deploying` | Worker | durum bir önceki adımsa |
| `cloning`/`building`/`pushing` → `cancelled` | Worker (iptal bayrağını görünce) | durum o anki adımsa |
| aktif durum → `failed` | Worker veya reaper | durum o anki adımsa |
| `deploying` → `succeeded` | Worker | durum `deploying` ise; **aynı transaction'da** yeni deployment `active`, eskisi `superseded` |

### Yarış senaryoları

| # | Senaryo | Sistem ne yapar |
|---|---|---|
| 1 | Push A kuyruktayken push B gelir | API tek transaction'da A'yı `cancelled` yapar ve B'yi `queued` oluşturur. Worker A'nın işini alınca claim 0 satır döner ve işi atlar. |
| 2 | A `building` iken B gelir | API'nin A'yı iptal etme denemesi 0 satır döner (A artık kuyrukta değil). API Redis'e A için iptal bayrağı yazar. Worker en geç 1 saniye içinde alt süreci öldürür ve A'yı `cancelled` yapar. |
| 3 | A `deploying` iken B gelir | A iptal edilmez, biter. B deploy aşamasına geldiğinde uygulama kilidini bekler, sonra deploy eder. |
| 4 | B, A'dan önce bitip aktif olur | A deploy aşamasına geldiğinde **eskime kontrolü** yapılır: aktif deployment'ın build'i A'dan daha yeni olduğu için A deploy edilmez ve `cancelled` (supersede) olur. |
| 5 | Kullanıcı iptal ederken worker aynı anda claim eder | İki koşullu güncellemeden biri kazanır. API 0 satır görürse bayrak yazar. |
| 6 | Worker build ortasında çöker | Heartbeat durur. Reaper 60 saniye sonra build'i `failed` yapar ("worker lost"). BullMQ işi yeniden verirse claim 0 satır döner. |
| 7 | Aynı delivery iki kez gelir | `webhook_deliveries` tablosundaki unique ihlali yakalanır; yanıt 200 "duplicate" olur ve iş başlamaz. |
| 8 | API DB'ye yazdı ama kuyruğa eklemeden çöktü | Reconciler, 30 saniyeden eski `queued` build'leri kuyruğa yeniden ekler. İş kimliği build kimliğine eşit olduğu için tekrar eklemek zararsızdır. |
| 9 | Aynı repo ve dala bağlı iki uygulama var | Her uygulama için ayrı build oluşur. |

### Uygulama başına deploy kilidi

- Deploy aşaması uygulama başına **Postgres advisory lock** ile tek seferde bir taneyle sınırlandırılır.
- Neden Redis kilidi değil: bağlantı koparsa (worker çökerse) kilit kendiliğinden düşer ve ek bağımlılık gerekmez.

---

## 9. Kuyruk ve Worker Tasarımı

- **Kuyruk:** tek BullMQ kuyruğu, `liman-pipeline`. İş türleri `build`, `deploy` (rollback ve redeploy için), `cleanup-app`.
- **İş kimliği = build ya da deployment kimliği.** Aynı iş iki kez eklenemez.
- **Deneme sayısı 1.** Başarısız build otomatik tekrar edilmez; kullanıcı yeniden tetikler. Tamamlanan işlerden son 1000'i saklanır.
- **Eşzamanlılık:** `WORKER_CONCURRENCY` (varsayılan 2).
- **Claim:** İşi alan worker önce `queued → cloning` geçişini dener. 0 satır dönerse işi sessizce bitirir.
- **Heartbeat:** Aktif build için her 10 saniyede `heartbeat_at` güncellenir.
- **Reaper** (worker açılışında ve dakikada bir çalışır):
  - Aktif durumda olup heartbeat'i 60 saniyeden eski build'leri `failed` yapar ("worker lost").
  - 30 saniyeden eski `queued` build'leri kuyruğa yeniden ekler (reconciler).
- **İptal:** Redis'te `liman:build:<id>:cancel` anahtarı (TTL 1 saat). Worker bu anahtarı adım aralarında ve uzun alt süreçler sırasında saniyede bir kontrol eder. Bayrak görülünce alt süreç ağacı sonlandırılır.
- **Zaman aşımı:** Clone + build + push için toplam `BUILD_TIMEOUT_SECONDS` (varsayılan 600). Aşılırsa build `failed` olur ve hata mesajı "timeout" yazılır.
- **Düzgün kapanış:** `SIGTERM` gelince yeni iş alınmaz. Mevcut işler 30 saniyeye kadar beklenir; bitmezse `failed` yapılır ("worker shutdown").
- **Açılışta reconcile:** DB'deki aktif deployment'lar ile gerçekte çalışan konteynerler karşılaştırılır; eksik olan yeniden başlatılır. Faz 1'de elle yazılan bu döngü, Faz 2'de Kubernetes controller'larının yaptığı işin ta kendisidir. NOTES.md'de bu benzerlik anlatılır.

---

## 10. API Yüzeyi

**Kurallar:**
- Bütün uçlar `/api` altındadır. Sağlık ve metrik uçları bunun dışındadır.
- Gövdeler ve sorgu parametreleri Zod ile doğrulanır.
- Hata biçimi her yerde aynıdır: `error` nesnesi içinde `code`, `message` ve isteğe bağlı `details`.
- Durum kodları: 400 doğrulama · 401 oturum yok · 403 sahibi değil / Origin hatalı · 404 · 409 çakışma (subdomain alınmış, iptal edilemez durum) · 429 hız sınırı.
- Sayfalama imleç (cursor) tabanlıdır.

| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/api/auth/github/login` | GitHub yetkilendirmesini başlat (`state` çereze yazılır) |
| GET | `/api/auth/github/callback` | `state` doğrulanır, izin listesi kontrol edilir, oturum açılır, installation'lar senkronlanır |
| POST | `/api/auth/logout` | Oturumu kapat (DB'den de silinir) |
| GET | `/api/me` | Oturumdaki kullanıcı |
| GET | `/api/github/setup` | App kurulum dönüşü. `installation_id` **doğrulanmadan kaydedilmez** |
| GET | `/api/github/installations` | Kullanıcının kurulumları ve kurulum linki |
| GET | `/api/github/installations/:id/repos` | Kuruluma açık repolar |
| GET | `/api/github/installations/:id/repos/:repoId/branches` | Dallar |
| GET / POST | `/api/apps` | Listele / oluştur |
| GET / PATCH / DELETE | `/api/apps/:id` | Detay / güncelle (dal, port, sağlık yolu; subdomain **değişmez**) / sil (202, temizlik arka planda) |
| GET / PUT | `/api/apps/:id/env` | Değerler maskeli döner. PUT bütün listeyi gönderir; değeri boş bırakılan anahtar eski değerini korur |
| GET | `/api/apps/:id/builds` | Build geçmişi |
| POST | `/api/apps/:id/builds` | Elle build (dalın son commit'i); uygulama başına 10 saniyede 1 |
| GET | `/api/builds/:id` | Build detayı |
| GET | `/api/builds/:id/logs` | Geçmiş loglar (`after_seq`, `limit` ≤ 1000) |
| GET | `/api/builds/:id/logs/stream` | **SSE** canlı log (Bölüm 11) |
| POST | `/api/builds/:id/cancel` | İptal (`deploying` ve sonrası için 409) |
| GET | `/api/apps/:id/deployments` | Deploy geçmişi |
| POST | `/api/apps/:id/deployments` | Belirtilen başarılı build'in imajını o anki env ile deploy et (rollback/redeploy) |
| POST | `/api/webhooks/github` | GitHub olayları (HMAC doğrulamalı) |
| GET | `/healthz` | Süreç ayakta mı |
| GET | `/readyz` | DB ve Redis erişimi var mı |
| GET | `/metrics` | Prometheus — **yalnızca iç ağdan**; Traefik'ten dışarı açılmaz |

---

## 11. Canlı Log Akışı

### Worker tarafı

- Alt süreç çıktısı satırlara bölünür. Docker'ın ilerleme çıktısındaki `\r` normalize edilir. 4 KB'den uzun satırlar kesilir.
- Her satıra build içinde artan bir `seq` verilir ve `stream` (`stdout`/`stderr`/`system`) etiketi eklenir. Aşama geçişleri `system` satırı olarak yazılır (ör. "▶ Building image").
- **Maskeleme, satır yazılmadan önce yapılır.** Installation token'ı, webhook sırrı ve env değerleri gibi bilinen sırlar `****` ile değiştirilir.
- **Satırlar önce DB'ye yazılır, sonra yayınlanır.** Satırlar 250 ms'de bir ya da 100 satırda bir toplu yazılır, ardından `liman:build:<id>:logs` kanalına yayınlanır.
- Build başına en fazla 20.000 satır tutulur. Aşılırsa tek bir uyarı satırı yazılır ve kalan satırlar atılır.
- Build bitince final durumla birlikte `end` mesajı yayınlanır.

### API tarafı (SSE ucu)

1. Oturum ve sahiplik kontrol edilir.
2. Akış başlıkları gönderilir. **Bu rotada sıkıştırma kapalıdır**; sıkıştırma akışı tamponlar.
3. **Önce kanala abone olunur**, gelen mesajlar tampona alınır.
4. **Sonra DB'den** `Last-Event-ID`'den (ya da ilk bağlantıda `after_seq`'ten) büyük satırlar sayfa sayfa okunup gönderilir. Her olayın `id` değeri `seq` olur.
5. Tampon boşaltılır; zaten gönderilmiş `seq` değerleri atlanır. Ardından canlı akışa geçilir.
6. Build zaten bitmişse geçmiş gönderilir, `end` olayı yollanır ve bağlantı kapatılır.
7. Proxy zaman aşımlarına karşı her 15 saniyede bir yorum satırı (heartbeat) gönderilir.
8. Her API süreci **tek bir Redis abone bağlantısı** açar ve mesajları istemcilere kendisi dağıtır. İstemci başına Redis bağlantısı açılmaz.

**Neden kayıp olmaz:** Bir satır abonelikten önce yayınlandıysa, worker önce yazdığı için o satır DB'dedir ve 4. adımda okunur. Abonelikten sonra yayınlanan satır tampona düşer. Çift gelen satır `seq` ile ayıklanır.

### Panel tarafı

- Bağlantı EventSource ile kurulur. Tarayıcı koptuğunda kendiliğinden yeniden bağlanır ve `Last-Event-ID` başlığını kendisi gönderir.
- Otomatik kaydırma vardır; kullanıcı yukarı kaydırınca durur.
- stderr satırları kırmızı, `system` satırları farklı stilde gösterilir.
- Bağlantı durumu göstergesi vardır. `end` olayı gelince bağlantı kapatılır.

---

## 12. Fazlar

Her alt bölüm bir dal ve bir PR'dır (Bölüm 16). Her fazın sonunda: ROADMAP kutucukları işaretlenir, `docs/NOTES.md` güncellenir ve sürüm etiketi atılır. Kontrol soruları mülakat hazırlığı içindir; ilerlemeyi engellemez.

---

### Faz 0 — İskelet · `v0.1.0`

**0.1 Monorepo**
- [ ] pnpm workspaces: `apps/api`, `apps/worker`, `apps/web`, `packages/shared`
- [ ] Node sürümünü sabitle; TypeScript strict ortak yapılandırma
- [ ] ESLint (flat config), Prettier, Vitest kök yapılandırması
- [ ] Ortak betikler: `dev`, `build`, `lint`, `typecheck`, `test`

**0.2 Ortak paket**
- [ ] Durum sabitleri, Zod şemaları, ortak tipler
- [ ] Subdomain doğrulayıcı ve testleri

**0.3 Yerel ortam (`infra/compose`)**
- [ ] postgres, redis, registry (5000), traefik (80; panel yalnızca 127.0.0.1:8080), api, worker, web
- [ ] `liman-internal` ve `liman-apps` ağları; kalıcı volume'lar
- [ ] postgres ve redis için sağlık kontrolleri; api bunları bekler
- [ ] Migration'lar için tek seferlik `migrate` servisi

**0.4 Veritabanı**
- [ ] Drizzle şeması (Bölüm 7, bütün tablolar) ve ilk migration
- [ ] Kısmi unique index'ler dahil

**0.5 Yapılandırma ve loglama**
- [ ] Ortam değişkenleri açılışta Zod ile doğrulanır; eksik ya da hatalı değerde süreç hiç başlamaz
- [ ] pino ile JSON log, istek kimliği
- [ ] `.env.example` (Bölüm 15)

**0.6 GitHub App**
- [ ] Geliştirme için ayrı bir App (`liman-dev`)
- [ ] Yetkiler: Contents (read), Metadata (read). Olaylar: `push`, `installation`, `installation_repositories`
- [ ] Callback URL, Setup URL ve smee.io webhook URL'si
- [ ] Kurulum adımları `docs/github-app-setup.md` dosyasında

**0.7 Kimlik**
- [ ] GitHub App kullanıcı yetkilendirmesi ile giriş; `state` doğrulaması
- [ ] İzin listesi **GitHub kullanıcı ID'si** ile kontrol edilir (login adı değişebilir)
- [ ] `sessions` tablosu; çerez httpOnly, SameSite=Lax, üretimde Secure ve `__Host-` önekli
- [ ] Durum değiştiren isteklerde Origin kontrolü (Bölüm 13)
- [ ] Giriş ucunda hız sınırı
- [ ] `/api/me`, `/api/auth/logout`

**0.8 Installation ve repolar**
- [ ] Setup dönüşünde gelen `installation_id`, kullanıcının kurulumları GitHub'dan sorgulanarak doğrulanır
- [ ] Girişte kurulumlar senkronlanır. Webhook ile senkron Faz 1.2'de gelir
- [ ] App JWT → installation token; token süresi dolmadan önbellekte tutulur
- [ ] Repo ve dal listeleme uçları

**0.9 Panel iskeleti**
- [ ] Giriş sayfası, ana yerleşim, kurulum yoksa "App'i kur" yönlendirmesi, repo listesi

**0.10 CI**
- [ ] Her PR'da ve main'de: kurulum (pnpm önbellekli), lint, typecheck, birim testler, build
- [ ] main dal koruması: PR zorunlu, CI yeşil olmadan merge yok

**0.11 Dokümantasyon**
- [ ] ADR-0001, ADR-0002, ADR-0003
- [ ] NOTES.md'ye Faz 0 bölümü; README iskeleti

**Bitti tanımı:** `docker compose up` ile her şey ayağa kalkıyor. GitHub ile giriş yapıp App'i kuruyorsun ve repolarını panelde görüyorsun. İzin listesinde olmayan bir hesap giremiyor. CI yeşil.

**Kontrol soruları**
- GitHub App ile OAuth App farkı ne, neden App seçtik?
- Setup dönüşünde gelen `installation_id`'ye neden güvenmiyoruz?
- Oturum çerezi neden httpOnly? SameSite=Lax neyi engeller, neyi engellemez?
- Ortam değişkenlerini açılışta doğrulamak neden önemli?

---

### Faz 1 — Docker ile Çalışan Ürün · `v0.2.0`

> Bu fazın sonunda **gösterilebilir bir ürün** olmalı. Faz 1 bitmeden Kubernetes'e geçilmez.

**1.1 Uygulama yönetimi**
- [ ] Uygulama CRUD
- [ ] Subdomain kuralları: 1–40 karakter, küçük harf, rakam ve tire; tireyle başlamaz/bitmez; `xn--` ile başlamaz. Rezerve adlar: `api`, `www`, `admin`, `liman`, `grafana`, `registry`, `traefik`
- [ ] Repo, kullanıcının kurulumuna açık repolardan seçilir; `repo_id` saklanır
- [ ] Env: şifreli kayıt, maskeli okuma, PUT semantiği, kurallar (Bölüm 7)
- [ ] Silme: durum `deleting` olur, `cleanup-app` işi kuyruğa girer, 202 döner
- [ ] Panel: uygulama listesi, yeni uygulama sihirbazı, env sekmesi

**1.2 Webhook**
- [ ] Webhook rotasında **ham gövde** alınır. İmza (HMAC-SHA256, `X-Hub-Signature-256`) ham gövde üzerinde, uzunluk kontrolü + sabit zamanlı karşılaştırma ile doğrulanır. Geçersizse 401
- [ ] Bu rotaya özel gövde boyutu limiti (GitHub en fazla 25 MB gönderir)
- [ ] Olay yönlendirme: `ping` → 200; `push`; `installation` (created/deleted/suspend/unsuspend); `installation_repositories`; diğerleri 202 ile yok sayılır
- [ ] `push` filtresi: dal silme push'ları yok sayılır; ref, repo_id ve installation eşleşmesine bakılır; eşleşen her uygulama için bir build oluşur
- [ ] Delivery kaydı, build ekleme ve kuyruktaki eski build'lerin iptali **tek transaction**'da yapılır; aktif build'ler için iptal bayrağı ve kuyruğa ekleme commit'ten sonra
- [ ] Yanıt 200 ms'nin altında (testte p95 ölçülür)
- [ ] smee ile lokal kurulum `docs/github-app-setup.md` dosyasına eklenir

**1.3 Worker ve durum makinesi**
- [ ] `Builder` ve `Deployer` arayüzleri; `DockerBuilder`, `DockerDeployer` ve testler için sahte implementasyonlar
- [ ] BullMQ işleyicisi (Bölüm 9): claim, heartbeat, reaper, reconciler, düzgün kapanış
- [ ] Clone: geçici dizin; installation token ile belirtilen commit SHA'sının sığ (shallow) çekimi; token loga düşmez; dizin her durumda silinir
- [ ] Build: `registry/liman/app-<id>:<sha>` etiketi; Liman label'ları (app-id, build-id)
- [ ] Push ve digest yakalama; `image_ref` digest ile kaydedilir
- [ ] Her adımda koşullu geçiş; hata durumunda `failed_stage` ve `error_message`
- [ ] Zaman aşımı ve iptal (Bölüm 9)
- [ ] Docker build önbelleğinin diski doldurmaması için periyodik temizlik
- [ ] ADR-0004, ADR-0005, ADR-0006

**1.4 Canlı log**
- [ ] Worker tarafı: satırlama, maskeleme, önce yaz sonra yayınla, `end` olayı (Bölüm 11)
- [ ] SSE ucu: abone ol → geçmişi oku → tamponu boşalt → canlı akış; heartbeat; tek abone bağlantısı
- [ ] Geçmiş log ucu (sayfalı)
- [ ] Panel: build detay sayfası, canlı log görünümü
- [ ] ADR-0007

**1.5 Deploy (Docker)**
- [ ] Yeni konteyner `liman-app-<appId>-<deploymentId>` adıyla `liman-apps` ağında başlatılır. Env çözülür, `PORT` eklenir. Yeniden başlatma politikası `unless-stopped`. Limitler: bellek 256 MB, CPU 0.5, pids 256. Privileged yok
- [ ] **Sağlık kontrolünü worker yapar:** konteyner adı ve portu üzerinden `health_path`'e 2 saniyede bir istek atılır; 60 saniye içinde art arda 3 başarılı yanıt (200–399) gerekir
- [ ] Konteyner erken çıkarsa beklenmez: çıkış kodu ve konteynerin son 50 log satırı build loguna yazılır
- [ ] **Trafik geçişi:** uygulamanın Traefik dinamik dosyası yeni konteyneri gösterecek şekilde atomik olarak yazılır (geçici dosyaya yaz, sonra yeniden adlandır). Traefik'in yeniden yüklemesi için kısa bir süre beklenir. Eski konteynere SIGTERM gönderilir (25 saniye süre), sonra kaldırılır
- [ ] Sağlık kontrolü geçmezse yeni konteyner kaldırılır, eski sürüm çalışmaya devam eder, deployment ve build `failed` olur
- [ ] Yeni deployment'ın `active`, eskisinin `superseded` olması ve build'in `succeeded` olması tek transaction'dadır
- [ ] Uygulama başına advisory lock; eskime kontrolü (Bölüm 8, senaryo 4)
- [ ] `POST /api/apps/:id/deployments`: rollback/redeploy. Build yapılmaz, deploy akışı aynıdır
- [ ] `cleanup-app` işi: konteynerler, dinamik dosya ve DB satırları silinir (imajlar Faz 3'teki temizlikte)
- [ ] Panel: deploy geçmişi, "Bu sürüme dön", env değişince "Yeniden deploy et" uyarısı
- [ ] ADR-0008, ADR-0009

**1.6 Testler, ölçüm, demo**
- [ ] Bölüm 14'teki birim ve entegrasyon senaryoları
- [ ] `liman-sample-app` reposu ve e2e betiği
- [ ] Ölçümler: ortalama build süresi, push'tan yayına süre (Bölüm 18)
- [ ] README v1: ne yapar, mimari şeması, ekran görüntüleri, kurulum, ölçümler, "How this was built"
- [ ] 2 dakikalık demo videosu: push → canlı log → yayında → bozuk commit → eski sürüm ayakta → rollback
- [ ] NOTES.md Faz 1 bölümü; kontrol soruları; `v0.2.0` etiketi ve release notları

**Bitti tanımı:**
- Örnek repoya push atınca panelde log canlı akıyor ve uygulama birkaç dakika içinde `sample.localhost` adresinde yayında.
- Bozuk bir commit (sağlık kontrolü başarısız) attığında eski sürüm çalışmaya devam ediyor.
- Build'i kırılan bir commit attığında build `failed (building)` oluyor.
- Art arda iki push'ta yalnızca sonuncusu yayına çıkıyor.
- Rollback çalışıyor.
- Worker'ı build ortasında öldürünce build `failed (worker lost)` oluyor.
- README ve demo videosu hazır.

**Kontrol soruları**
- Build neden HTTP isteğinin içinde değil de kuyrukta yapılıyor?
- Webhook imzası doğrulanmazsa saldırgan ne yapabilir? Neden sabit zamanlı karşılaştırma?
- İmza neden ham gövde üzerinde doğrulanmalı?
- Aynı repoya art arda iki push gelirse ne oluyor? 1, 2, 3 ve 4 numaralı senaryoları anlat.
- Koşullu güncelleme yarışları nasıl çözüyor? Kilit kullanmadan neden yetiyor?
- Worker build ortasında çökerse ne olur, kim fark eder?
- API kuyruğa eklemeden çökerse build neden sonsuza kadar `queued` kalmaz?
- Log akışında neden SSE? Bir satırın kaybolmadığını nasıl garanti ediyoruz?
- Yeni sürüm sağlık kontrolünden geçmezse ne oluyor? Trafik tam olarak hangi anda yeni konteynere geçiyor?
- Neden etiket değil digest ile deploy ediyoruz?
- Faz 1'de hangi izolasyon eksik, neden kabul ettik?

---

### Faz 2 — Kubernetes · `v0.3.0`

Faz 1'de elle çözdüğün sorunları (çöken konteyneri yeniden başlatma, kesintisiz geçiş, kaynak çakışması, reconcile döngüsü) Kubernetes'e devrediyorsun.

**2.1 Cluster**
- [ ] k3s 1.36+ (user namespaces bu sürümde GA). Build izolasyonu (2.3) için **gerçek bir Linux ortamı** tercih edilir: yerel VM ya da Faz 4'te kullanılacak VPS'in bu aşamada alınması. k3d hızlı denemeler için uygun, ancak iç içe konteyner yapısı nedeniyle user namespace ile build orada çalışmayabilir
- [ ] Kernel ≥ 6.3, containerd 2.x, runc ≥ 1.2 kontrolü (`docs/NOTES.md`'ye yaz)
- [ ] Namespace'ler: `liman-system` (Liman), `liman-builds` (build Job'ları), `app-<id>` (uygulamalar)
- [ ] `infra/k8s`: api, worker, web (statik dosya sunucusu), postgres (StatefulSet + PVC), redis, registry (PVC)
- [ ] **Registry erişimi:** pod'lar registry'ye cluster DNS ile ulaşır, ancak node'daki containerd cluster DNS'ini **çözemez**. Registry bir NodePort ile açılır ve k3s'in registry yapılandırmasında bir ayna adıyla tanıtılır. Push adı ile pull adı farklı olabilir; depo ve digest aynıdır (ADR-0013)

**2.2 Deploy katmanı (`KubernetesDeployer`)**
- [ ] Uygulama başına üretilen kaynaklar:
  - Namespace (Liman label'ları, Pod Security Admission `baseline`)
  - ServiceAccount (token otomatik bağlanmaz)
  - Secret (env), Deployment, Service, Ingress (Traefik)
  - ResourceQuota, LimitRange, HPA, NetworkPolicy'ler
- [ ] Server-side apply, sabit field manager. **Deployment'ta `replicas` alanı gönderilmez**, yoksa her apply HPA ile kavga eder
- [ ] Env değişince pod'ların yenilenmesi için pod şablonuna env özetini (hash) gösteren bir annotation eklenir. Secret değişince pod'lar kendiliğinden yenilenmez
- [ ] Probe'lar (HTTP, kullanıcının portunda, `health_path`):
  - startupProbe: 120 saniyeye kadar açılış süresi
  - readinessProbe: 5 sn aralık, 3 hata
  - livenessProbe: daha toleranslı, 10 sn aralık, 6 hata; gereksiz öldürme döngüsünü önler
- [ ] Kapanış: K8s'in yerleşik `sleep` preStop eylemi (5 sn; imajda sleep komutu gerekmez), `terminationGracePeriodSeconds: 30`
- [ ] Rolling update: `maxUnavailable: 0`, `maxSurge: 1`, `progressDeadlineSeconds: 180`
- [ ] Rollout izleme (`kubectl rollout status` mantığı): observedGeneration, updated, available ve unavailable sayıları. Süre aşımında pod olayları ve son loglar build loguna yazılır, **önceki imaj yeniden apply edilir** (K8s otomatik rollback yapmaz), deployment ve build `failed` olur
- [ ] HPA: CPU %70 hedef, min 1 / max 3 (metrics-server k3s ile gelir)
- [ ] Uygulama silinince namespace silinir ve silinmesi beklenir
- [ ] `DEPLOYER=docker|kubernetes` ile seçim; Docker yolu testler için korunur

**Kaynak hesabı** (varsayılanlar; HPA max 3 + rollout sırasında 1 fazladan pod + 1 pay = 5 pod):

| Kaynak | Pod başı (LimitRange varsayılanı) | Namespace tavanı (ResourceQuota) |
|---|---|---|
| CPU request | 100m | 500m |
| Bellek request | 128 Mi | 640 Mi |
| CPU limit | 500m | 2500m |
| Bellek limit | 256 Mi | 1280 Mi |
| Pod sayısı | — | 5 |
| Ek | — | Service 2; LoadBalancer, NodePort ve PVC 0 |

> Quota rollout'taki fazladan pod'u karşılamazsa rollout sessizce takılır. Hesap bu yüzden yazılı.

**NetworkPolicy (uygulama namespace'i):**
- [ ] Varsayılan olarak tüm giriş ve çıkış kapalı
- [ ] Giriş: yalnızca Traefik pod'larından, uygulama portuna
- [ ] Çıkış: kube-dns (UDP/TCP 53) ve internet. Pod CIDR'ı, servis CIDR'ı, node IP'leri ve bulut metadata adresi (169.254.169.254) hariç
- [ ] k3s'in yerleşik NetworkPolicy denetleyicisinin çalıştığı testle doğrulanır

**2.3 Build'i cluster'a taşı (`BuildahJobBuilder`)**
- [ ] Her build `liman-builds` içinde bir Job:
  - init container: git içeren küçük bir imajla clone; token, build'e özel ve Job'a bağlı (ownerReference) bir Secret'tan okunur
  - ana container: Buildah ile build + push
- [ ] **İzolasyon merdiveni** (yukarıdan aşağı denenir, sonuç ADR-0012'ye yazılır):
  1. `hostUsers: false` (user namespace) + Buildah konteyner içinde root + chroot izolasyonu
  2. Rootless Buildah (UID 1000) + gevşetilmiş seccomp/AppArmor
  3. Rootless BuildKit
  4. `privileged` — **kabul edilmez**; zorunlu kalınırsa ADR'de açıkça risk olarak yazılır
- [ ] Limitler: CPU 1.5, bellek 2 Gi, **ephemeral-storage 6 Gi** (build'ler diski doldurur), `activeDeadlineSeconds: 600`, `backoffLimit: 0`, `ttlSecondsAfterFinished: 3600`, ServiceAccount token yok
- [ ] Digest, container'ın termination message'ı üzerinden worker'a iletilir
- [ ] Worker init ve ana container loglarını takip edip aynı log hattına aktarır
- [ ] İptal = Job'u sil
- [ ] **`liman-builds` NetworkPolicy:** giriş tamamen kapalı. Çıkış DNS, registry ve internete (paket kurulumu) açık; `liman-system` (postgres, redis, API) ve uygulama namespace'leri **kapalı**
- [ ] Worker artık Docker socket'ine erişmiyor; worker imajında Docker CLI yok

**2.4 Worker yetkileri**
- [ ] Worker ServiceAccount'u için ClusterRole: namespace oluşturma ve silme; uygulama namespace'lerinde kullanılan kaynak türleri; `liman-builds` içinde Job, Pod, pod logları ve Secret
- [ ] Cluster genelinde geniş yetkinin bilinen bir risk olduğu ADR-0011'de yazılır

**2.5 Doğrulama**
- [ ] k6 ile yük: HPA pod sayısını artırıyor
- [ ] Yük altında güncelleme: sıfır hata
- [ ] Bir pod'u elle sil: geri geliyor
- [ ] app-A'daki bir pod app-B'ye ulaşamıyor (zaman aşımı)
- [ ] Build Job'u postgres'e ulaşamıyor (testi bir Dockerfile `RUN` satırı ile yap)
- [ ] ADR-0010 … ADR-0013; NOTES.md Faz 2; `v0.3.0`

**Bitti tanımı:** Yük testiyle zorlanınca pod sayısı artıyor. Elle silinen pod geri geliyor. Güncelleme sırasında yük testi sıfır hata veriyor. Uygulamalar birbirine ve Liman'ın iç servislerine erişemiyor. Build'ler privileged olmadan çalışıyor. Worker'da Docker socket yok.

**Kontrol soruları**
- Bir uygulama sonsuz döngüye girerse diğerleri neden etkilenmiyor?
- Startup, readiness ve liveness probe farkı ne? Hiçbiri olmasa ne olurdu?
- `maxUnavailable: 0` ne garanti ediyor, quota neden buna göre hesaplanmalı?
- Neden Deployment'a `replicas` göndermiyoruz?
- Secret değişince pod'lar neden kendiliğinden yenilenmez, biz nasıl çözdük?
- Docker socket'i build'e vermek neden tehlikeli? User namespace neyi değiştiriyor?
- Kötü niyetli bir Dockerfile build sırasında ne yapmaya çalışabilir, hangisini nasıl engelledik?
- Node neden registry'yi cluster DNS adıyla çekemiyor?
- HPA'yı CPU'ya bağladık; bu hangi uygulama türü için yanlış metrik olur?
- Faz 1'de elle yazdığımız reconcile döngüsünün K8s'teki karşılığı ne?

---

### Faz 3 — Gözlemlenebilirlik ve Otomasyon · `v0.4.0`

**3.1 Metrikler**
- [ ] API ve worker `/metrics` ucu. Worker'da ayrı, yalnızca iç ağa açık bir port
- [ ] Metrikler:
  - `liman_builds_total{status}`
  - `liman_build_duration_seconds` (histogram)
  - `liman_build_stage_duration_seconds{stage}`
  - `liman_queue_depth`
  - `liman_deployments_total{result}`
  - `liman_sse_connections`
  - `liman_http_request_duration_seconds{method,route,status}`
- [ ] **Kardinalite kuralı:** label'larda ham URL yolu, build id ve app id kullanılmaz; rota şablonu kullanılır

**3.2 Prometheus + Grafana**
- [ ] kube-prometheus-stack, **hafifletilmiş değerlerle**: 7 günlük saklama, 30 sn scrape aralığı, gereksiz bileşenler kapalı
- [ ] API ve worker için ServiceMonitor
- [ ] Dashboard JSON `infra/grafana`'da: hata oranı, gecikme, kuyruk derinliği, build başarı oranı, node kaynakları

**3.3 Loglar**
- [ ] Loki (7 gün saklama) + Grafana Alloy
- [ ] Panelde uygulama için "runtime logs" sekmesi; API, uygulamanın namespace'i için Loki'ye vekâleten sorgu atar

**3.4 Alarmlar** (Alertmanager → Telegram veya e-posta)
- [ ] 15 dakikada 3'ten fazla başarısız build
- [ ] 10 dakika boyunca artan kuyruk derinliği
- [ ] Worker metrik vermiyor

**3.5 Temizlik**
- [ ] Registry: her uygulama için son 5 başarılı build ve aktif imaj tutulur. Hangi digest'lerin silineceği DB'den hesaplanır; silme registry API'si ile yapılır (silme özelliği açık olmalı). Disk alanını geri almak için gece GC çalışır; bu sırada registry salt okunur moda alınır
- [ ] `build_logs`: uygulama başına son 20 build'in logları tutulur
- [ ] `webhook_deliveries`: 7 günden eski kayıtlar silinir

**3.6 Helm chart (`infra/helm/liman`)**
- [ ] values ile yapılandırma: domain, TLS, kaynaklar, sırlar için hazır Secret referansı
- [ ] Migration'lar pre-upgrade hook Job'u olarak çalışır
- [ ] CI'da chart lint ve template kontrolü

**3.7 Self-deploy**
- [ ] main'e merge → api, worker ve web imajları build edilir, GHCR'ye `sha` ve sürüm etiketiyle push edilir
- [ ] Deploy: kısıtlı bir deploy kullanıcısıyla SSH üzerinden VPS'te atomik Helm upgrade (başarısızsa otomatik geri alınır). GitHub `production` environment koruması
- [ ] K8s API'si (6443) internete açılmaz
- [ ] ADR-0014: neden SSH (elenenler: kubeconfig'i GitHub'a vermek, Tailscale, Flux/Argo)
- [ ] ADR-0015; NOTES.md Faz 3; `v0.4.0`

**Bitti tanımı:** Grafana'da tek ekrandan sistemin sağlığını okuyabiliyorsun. Bir alarm gerçekten telefonuna düşüyor. main'e merge Liman'ı otomatik güncelliyor; bozuk bir sürüm otomatik geri alınıyor.

**Kontrol soruları**
- Sistemin sağlıklı olduğunu hangi üç metrikle söylersin?
- Metrik label'ına build id koymak neden kötü bir fikir?
- Liman'ın kendi imajları neden Liman'ın registry'sinde değil?
- Registry GC neden iki adımlı ve neden salt okunur mod gerekiyor?

---

### Faz 4 — Canlıya Çıkış · `v1.0.0`

**4.1 Sunucu**
- [ ] VPS: **4 vCPU / 8 GB**, Ubuntu 24.04 LTS (kernel user namespaces için yeterli). 4 GB, izleme yığını ve build'lerle birlikte yetmez (Bölüm 18'deki bütçe)
- [ ] Sertleştirme: yalnızca SSH anahtarı, root girişi kapalı, güvenlik duvarında yalnızca 22/80/443 açık, otomatik güvenlik güncellemeleri

**4.2 k3s**
- [ ] Secret'ların diskte şifrelenmesi açık
- [ ] Pod başına süreç sayısı limiti (kubelet argümanı)
- [ ] Registry yapılandırması (2.1'deki ayna)

**4.3 DNS**
- [ ] Alan adı; `liman.alanadi.com` ve `*.alanadi.com` VPS'e yönlenir
- [ ] Başlangıçta DNS sağlayıcı proxy'si kapalı; değişken sayısını azaltmak için

**4.4 TLS**
- [ ] cert-manager + **DNS-01**. DNS sağlayıcı API anahtarı yalnızca o zone'da DNS düzenleme yetkili
- [ ] Önce Let's Encrypt **staging**, sonra prod; doğrudan prod'a gitmek limitlere takılabilir
- [ ] `*.alanadi.com` + `alanadi.com` sertifikası Traefik'in varsayılan sertifikası olur; HTTP → HTTPS yönlendirmesi
- [ ] Not: wildcard sertifika HTTP-01 ile alınamaz; her subdomain'e ayrı sertifika almak da limitlere takılabilir

**4.5 Yedekleme**
- [ ] Günlük PostgreSQL yedeği (CronJob) → sunucu dışında S3 uyumlu depolama. 7 günlük + 4 haftalık saklama
- [ ] **Geri yükleme tatbikatı** yapılır ve `docs/runbooks/restore.md`'ye yazılır. Geri yüklenmemiş yedek, yedek sayılmaz
- [ ] `LIMAN_ENCRYPTION_KEY` ve GitHub App özel anahtarı parola yöneticisinde. Bunlar olmadan yedek işe yaramaz
- [ ] Registry verisi yedeklenmez; build'lerden yeniden üretilebilir

**4.6 Kendi projelerini taşı**
- [ ] Crypto Alert System ve Application Tracking System Uygulama Sözleşmesi'ne uydurulur (Dockerfile, `0.0.0.0`, sağlık yolu)
- [ ] Veritabanı gereken projeler **harici bir veritabanı** kullanır ve bağlantı bilgisi env ile verilir (yönetilen DB kapsam dışı)

**4.7 Son dokunuşlar**
- [ ] README son hâli: mimari, ekran görüntüleri, demo videosu, ölçümler, kurulum, güvenlik modeli
- [ ] `docs/runbooks/`: geri yükleme, şifreleme anahtarı rotasyonu, takılan worker, disk dolu
- [ ] NOTES.md Faz 4; `v1.0.0`

**Bitti tanımı:** Projelerin gerçekten Liman üzerinde, HTTPS ile yayında ve linkini paylaşabiliyorsun. Yedekten geri yüklemeyi bir kez gerçekten yaptın.

**Kontrol soruları**
- Wildcard sertifika neden HTTP-01 ile alınamıyor?
- Neden önce staging?
- Şifreleme anahtarını kaybedersen ne kaybedersin?
- Sunucu tamamen giderse sıfırdan ayağa kaldırma adımların neler?

---

## 13. Güvenlik

Rastgele kod build edip çalıştıran bir sistem. Bunun bilincinde olduğunu göstermek ayrı bir artı.

| Tehdit | Önlem | Faz |
|---|---|---|
| Sahte webhook ile build tetikleme | Ham gövde üzerinde HMAC, sabit zamanlı karşılaştırma; imza doğrulanmadan hiçbir iş başlamaz | 1 |
| Eski bir teslimatı tekrar gönderme | `X-GitHub-Delivery` tekilleştirmesi | 1 |
| Yetkisiz giriş | Public kayıt kapalı; izin listesi GitHub ID ile; giriş ucunda hız sınırı | 0 |
| Kardeş subdomain'deki bir uygulamadan CSRF | Uygulamalar panelle **aynı site** sayılır, bu yüzden SameSite tek başına korumaz. Durum değiştiren isteklerde Origin başlığı panelin origin'iyle birebir eşleşmeli | 0 |
| Kardeş subdomain'den oturum çerezi enjekte etme | Üretimde `__Host-` önekli oturum çerezi. İdeal çözüm kullanıcı uygulamalarını ayrı bir kayıtlı alan adında tutmak (Vercel'in `vercel.app`'i gibi); tek alan adıyla bu önlemler zorunlu | 0 / 4 |
| Kötü niyetli Dockerfile (build sırasında) | F1: yalnızca izinli kullanıcıların repoları, kabul edilen risk. F2: user namespace'li Job, kaynak/süre/disk limitleri, NetworkPolicy | 1 / 2 |
| Uygulamalar arası erişim | F2: NetworkPolicy ile varsayılan olarak kapalı | 2 |
| Uygulamanın K8s API'sine erişmesi | ServiceAccount token bağlanmaz; çıkışta node IP'leri kapalı | 2 |
| Kaynak tüketimi (sonsuz döngü, fork bombası, bellek) | F1: Docker limitleri. F2: LimitRange, ResourceQuota, pids limiti | 1 / 2 |
| Diskin dolması | Build ephemeral-storage limiti, registry GC, log saklama sınırı, Docker build önbelleği temizliği | 1–3 |
| Sırların sızması | AES-256-GCM + AAD; maskeli okuma; loglarda maskeleme; env yalnızca çalışma zamanında; `.env` repoda yok; App anahtarı dosyadan/Secret'tan | 1 |
| Token sızması | Kullanıcı token'ı saklanmaz; installation token'ı en fazla 1 saat geçerli ve loglarda maskeli | 0 / 1 |
| İç servislerin dışarı açılması | Registry, Traefik paneli, `/metrics` ve K8s API'si dışarı kapalı | 1 / 4 |
| Bulut metadata servisine erişim | NetworkPolicy çıkışında 169.254.169.254 kapalı | 2 |
| Bağımlılık tedarik zinciri | Kilitli lockfile, CI'da bağımlılık denetimi | 0 |

---

## 14. Test Stratejisi

| Seviye | Araç | Kapsam |
|---|---|---|
| Birim | Vitest | Doğrulayıcılar, HMAC, şifreleme, durum geçiş kuralları, log satırlama ve maskeleme, K8s manifest üretimi |
| Entegrasyon | Vitest + Testcontainers (postgres, redis) | API ↔ DB ↔ Redis ↔ worker; sahte `Builder`/`Deployer` ile |
| Uçtan uca | `liman-sample-app` + betik | Gerçek build ve deploy |
| Yük | k6 | Rolling update hata oranı, HPA tepkisi |

### Zorunlu senaryolar

**Birim**
- Subdomain: geçerli, geçersiz ve rezerve örnekler
- HMAC: doğru imza, yanlış imza, eksik başlık, farklı uzunluk
- Şifreleme: gidiş-dönüş; AAD değişince çözülmez; sürüm öneki
- Log: `\r` normalizasyonu, uzun satır kesme, maskeleme

**Entegrasyon**
- Geçersiz imza → 401, kayıt yok
- Yanlış dal → 202, kayıt yok
- Aynı delivery iki kez → tek build
- Mutlu yol: `queued` → … → `succeeded`; aktif deployment tek
- Senaryo 1, 2, 3 ve 4 (Bölüm 8)
- Zaman aşımı → `failed`
- Sağlık kontrolü başarısız → eski deployment aktif kalır
- Worker kaybı → reaper `failed` yapar
- Kuyruğa eklenmemiş build → reconciler ekler
- SSE: geçmiş + canlı satırlarda boşluk ve çift olmamalı; `Last-Event-ID` ile devam
- Origin hatalı POST → 403

**Uçtan uca**
- Gerçek GitHub push'una bağımlı olmamak için betik, `liman-sample-app`'teki bilinen bir commit için **imzalı sahte webhook** gönderir. Gerçek push ile deneme ayrıca elle yapılır.
- Sırasıyla: sağlam commit → yayında; sağlık kontrolü bozuk commit → eski sürüm ayakta; build'i kırık commit → `failed (building)`; rollback.

### `liman-sample-app`

Ayrı repo, basit bir Node HTTP sunucusu:
- `/` sürüm bilgisini döner (env'den), `/healthz` sağlık yoludur
- `/work?ms=` CPU harcar (HPA testi)
- SIGTERM'de düzgün kapanır
- Senaryolar için dallar ya da etiketler: `good`, `bad-health` (sağlık yolu 500 döner), `bad-build` (Dockerfile hatalı), `crash` (açılışta çıkar)

---

## 15. Ortam Değişkenleri

`.env.example` bu tabloyla birebir aynı tutulur.

| Değişken | Örnek | Not |
|---|---|---|
| `NODE_ENV` | development | |
| `LOG_LEVEL` | info | |
| `LIMAN_PUBLIC_URL` | http://liman.localhost | Origin kontrolü ve yönlendirmeler |
| `LIMAN_BASE_DOMAIN` | localhost | Uygulama adresleri `<sub>.<bu>` olur |
| `DATABASE_URL` | postgres://… | |
| `REDIS_URL` | redis://… | |
| `LIMAN_ENCRYPTION_KEY` | (32 bayt base64) | Kaybolursa env değerleri kaybolur |
| `LIMAN_ALLOWED_GITHUB_IDS` | 12345678 | Virgülle ayrılmış GitHub kullanıcı ID'leri |
| `SESSION_TTL_HOURS` | 168 | |
| `GITHUB_APP_ID` | | |
| `GITHUB_APP_SLUG` | liman-dev | Kurulum linki için |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | | Kullanıcı girişi |
| `GITHUB_APP_PRIVATE_KEY_PATH` | ./secrets/app.pem | Repoya girmez |
| `GITHUB_WEBHOOK_SECRET` | | |
| `SMEE_URL` | https://smee.io/… | Yalnızca geliştirme |
| `REGISTRY_HOST` | localhost:5000 | |
| `WORKER_CONCURRENCY` | 2 | |
| `BUILD_TIMEOUT_SECONDS` | 600 | |
| `DEPLOY_HEALTH_TIMEOUT_SECONDS` | 60 | |
| `BUILDER` / `DEPLOYER` | docker / docker | Faz 2'de `buildah-job` / `kubernetes` |
| `TRAEFIK_DYNAMIC_DIR` | /traefik/dynamic | Faz 1 |
| `APP_DEFAULT_MEMORY_MB` / `APP_DEFAULT_CPUS` | 256 / 0.5 | Faz 1 |

---

## 16. Git İş Akışı ve Commit Geçmişi

### 16.1 Temel kural

**Commit tarihleri gerçektir.** Geçmiş yeniden yazılmaz, tarih ayarlanmaz, main'e force push yapılmaz. Geçmiş, işin gerçekten nasıl ilerlediğini gösterir.

### 16.2 Neden alt bölüm başına bir oturum?

Claude Code kodu hızlı yazar, ama her alt bölüm gözden geçirilebilir olmalı. Bu yüzden oturum başına en fazla bir alt bölüm yapılır; her biri kendi issue'su, dalı, PR'ı ve CI koşusuyla ilerler. Gerçek altyapı işleri (GitHub App, smee, Docker ağları, k3s, user namespace, DNS, sertifika) deneme yanılma ister; bu da geçmişe doğal olarak yansır.

### 16.3 Akış: Issue → Dal → PR → Merge

1. **Issue:** Her alt bölüm bir issue'dur; içindeki kutucuklar issue'da görev listesidir. Her faz bir **Milestone**'dur. Etiketler: `faz-0` … `faz-4`, `area/api`, `area/worker`, `area/web`, `area/infra`, `type/feat`, `type/bug`.
2. **Dal:** `<tip>/<faz.no>-<kisa-ad>`, ör. `feat/1.2-webhook`.
3. **Commit:** Her alt görev ayrı commit. Conventional Commits (`feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `ci`, `build`). Mesaj İngilizce ve emir kipinde; gerekiyorsa gövdede nedeni yazılır.
4. **PR** (`gh` ile açılır, issue'yu kapatır). Şablon:
   - **What** — ne yapıldı
   - **Why** — neden böyle; ilgili ADR
   - **How tested** — hangi testler, hangi komut
   - **Türkçe özet** — Claude Code yazar; 3–5 satırda ne yapıldı ve neden. Mülakat hazırlığının ham malzemesi budur
5. **Merge:** CI yeşilse Claude Code merge eder. **Merge commit** kullanılır, squash yapılmaz; ayrıntılı commit geçmişi korunur.

### 16.4 Sürümler

- Faz sonları etiketlenir: `v0.1.0` (Faz 0), `v0.2.0` (Faz 1), `v0.3.0` (Faz 2), `v0.4.0` (Faz 3), `v1.0.0` (Faz 4).
- Her etiket için GitHub Release notu yazılır; `CHANGELOG.md` Conventional Commits'ten üretilir.
- Faz sonunda ROADMAP kutucukları işaretlenir; bu ayrı bir `docs:` commit'idir.

### 16.5 Şeffaflık

README'de kısa bir **"How this was built"** bölümü olur: Claude Code'un eşli programlama aracı olarak kullanıldığı, mimari kararların ADR'lerde belgelendiği ve her parçanın anlatılabileceği yazılır. Mülakatta "bunu sen mi yazdın?" sorusunun en güçlü cevabı budur: kararları ve nedenlerini anlatabilmek.

### 16.6 Claude Code için yasaklar

- main'e doğrudan commit veya push
- Commit tarihini, yazarını veya geçmişi değiştirmek
- CI kırmızıyken merge
- `.env`, anahtar dosyaları veya `secrets/` dizinini commit'lemek

---

## 17. ADR Listesi

ADR'ler Türkçe yazılır ve şu başlıkları içerir: Bağlam, Karar, Elenen alternatifler, Sonuçlar.

| No | Faz | Başlık |
|---|---|---|
| 0001 | 0 | Monorepo ve teknoloji seçimi |
| 0002 | 0 | OAuth App yerine GitHub App |
| 0003 | 0 | Oturum yönetimi, çerez ve CSRF stratejisi |
| 0004 | 1 | Durum geçişleri: koşullu güncelleme, sahiplik ve deploy kilidi |
| 0005 | 1 | Kuyruk: tek deneme, heartbeat, reaper, reconciler |
| 0006 | 1 | Build'de Docker socket kullanmanın riski ve neden geçici olduğu |
| 0007 | 1 | Log akışı: SSE ve WebSocket karşılaştırması; sıralama garantisi |
| 0008 | 1 | Faz 1 trafik geçişi: Traefik file provider (Docker label'ları neden yetmedi) |
| 0009 | 1 | Env yalnızca çalışma zamanında; rollback env'i geri almaz |
| 0010 | 2 | Builder/Deployer soyutlaması ve K8s'e geçiş |
| 0011 | 2 | Çok kiracılık: namespace, quota, NetworkPolicy, worker RBAC |
| 0012 | 2 | Docker socket → Buildah (user namespace); Kaniko neden değil; izolasyon merdiveninin sonucu |
| 0013 | 2 | Registry erişimi: node ve pod için farklı adlar |
| 0014 | 3 | Liman imajları GHCR'de; SSH ile self-deploy |
| 0015 | 3 | Gözlemlenebilirlik yığını ve bellek bütçesi |
| 0016 | 4 | Wildcard TLS: DNS-01 |
| 0017 | 4 | Yedekleme ve geri yükleme |

---

## 18. Ölçüm ve README

### Ölç ve kaydet

README'ye yalnızca gerçek değerler girer. Her ölçümün yöntemi README'de yazılır.

| Ölçüm | Yöntem |
|---|---|
| Ortalama build süresi | Örnek uygulama, 10 build'in `finished_at − started_at` ortancası |
| Push'tan yayına süre | e2e betiğinde `git push` anından, yeni sürüm bilgisinin ilk kez dönmesine kadar; 10 ölçümün ortancası |
| Güncelleme sırasında hata oranı | k6, sabit yük altında yeni sürüm deploy edilirken başarısız istek yüzdesi |
| Eşzamanlı uygulama sayısı | VPS'te kararlı çalışan uygulama sayısı ve o andaki bellek kullanımı |
| Webhook yanıt süresi | Entegrasyon testinde p95 |

### Bellek bütçesi (8 GB VPS, tahmini, Faz 3'te ölçülerek güncellenir)

| Bileşen | Yaklaşık |
|---|---|
| k3s + sistem + Traefik | ~0.8 GB |
| Postgres, Redis, registry | ~0.5 GB |
| API, worker, web | ~0.4 GB |
| Prometheus, Grafana, Loki, Alloy, Alertmanager, exporter'lar | ~1.5–2 GB |
| Eşzamanlı 2 build | ≤ 4 GB (limit) |
| Uygulamalar | kalan |

### NOTES.md'de mutlaka anlatılacak üç "zor problem"

1. Art arda push'larda yarışlar ve koşullu güncelleme
2. Kesintisiz trafik geçişi: Faz 1'de elle, Faz 2'de K8s ile
3. Güvenilmeyen kodu build etmek: Docker socket'ten user namespace'e

---

## 19. Diğer Projelerle Bağlantı (opsiyonel, en sona)

- **Ulak (Proje 2):** Deploy başarılı/başarısız olaylarını Ulak'a gönder; Ulak bunları abonelere webhook olarak teslim etsin.
- **Nabız (Proje 3):** Liman'da yayına alınan her uygulama için Nabız'da otomatik izleme kaydı oluştur.
- **Gözcü (Proje 4):** Gözcü'nün API'si Liman üzerinde yayında olsun.

Her proje bağımsız çalışmalı; bu bağlantılar sonradan eklenen entegrasyonlardır.

---

## 20. Tuzaklar

1. **Faz 1 bitmeden Kubernetes'e geçmek.** Proje en çok burada ölür.
2. **Claude Code'un yazdığını hiç okumamak.** Mülakatta ilk ortaya çıkan şey budur. PR'lardaki Türkçe özetler, NOTES.md ve kontrol soruları bunun için var.
3. **Panele vakit gömmek.** Arayüz sade olsun; değerlendirilen şey backend ve altyapı.
4. **Kapsamı büyütmek.** "Yok" listesi kesindir; yeni fikirler park alanına gider.
5. **Ölçmeden sayı yazmak.** README'deki her sayı gerçek bir ölçüme dayanmalı.
6. **Webhook'un localhost'a gelmesini beklemek.** smee kurulmadan 1.2 test edilemez.
7. **Uygulamanın `127.0.0.1`'de dinlemesi.** Örnek uygulamada ve kendi projelerinde önce bunu kontrol et.
8. **Token'ın build loguna sızması.** git hata mesajları URL'yi basabilir; maskeleme zorunlu.
9. **Build önbelleğinin ve imajların diski doldurması.** Faz 1'den itibaren temizlik.
10. **Deployment'a `replicas` göndermek.** HPA ile sürekli çakışır.
11. **Quota'yı rollout'taki fazladan pod'u hesaba katmadan ayarlamak.** Rollout sessizce takılır.
12. **Default-deny NetworkPolicy'nin DNS'i ve Traefik'i kesmesi.**
13. **Registry'nin node'da cluster DNS adıyla çekilmeye çalışılması.**
14. **Let's Encrypt prod'a staging denemeden gitmek.**
15. **Yedeği geri yüklemeyi hiç denememek.**

---

## Ek — Yeni Sohbet İçin Bağlam

> Bu bölüm, projeye yeni bir sohbette veya yeni bir Claude Code oturumunda devam eden yapay zekâ içindir. Çalışmaya başlamadan önce oku.

### Kim, neden bu proje

Enes, bilgisayar mühendisliği öğrencisi; hedef alanı backend ve DevOps/bulut. Bu proje 4 projelik serinin **1. projesi**: kuyruk, durum makinesi, webhook güvenliği, konteyner izolasyonu ve rolling update gibi konuları kendi kurduğu bir sistem üzerinden öğrenmek ve göstermek.

### Bu projenin amacı

- Enes'in kendi projelerini SSH, nginx ve SSL uğraşı olmadan yayına almak için **gerçekten kullanacağı** bir platform kurmak.
- Kubernetes'in süs değil zorunlu olduğu bir sistem: çok kiracılı izolasyon, kaynak limitleri, otomatik ölçekleme, kesintisiz güncelleme.
- Mülakatta kuyruk, durum makinesi, webhook güvenliği, konteyner izolasyonu ve rolling update gibi konuları somut ve kendi kurduğu bir sistem üzerinden anlatabilmek.

### Seri

| # | Proje | Odak | Dil |
|---|---|---|---|
| 1 | **Liman** — Mini PaaS | DevOps + backend | TypeScript |
| 2 | **Ulak** — Webhook teslimat servisi | Backend | Go |
| 3 | **Nabız** — Uptime izleme ve durum sayfası | Full-stack + DevOps | TypeScript |
| 4 | **Gözcü** — Hava görüntülerinde değişiklik tespiti | Görüntü işleme + ML | Python |

Önerilen sıra 1 → 2 → 3 → 4. Her proje bağımsız çalışır.

### Nasıl çalışıyoruz

- **Kodun tamamını Claude Code yazar.** Enes yönetir: görevi verir, planı onaylar, sonucu dener. Enes bu teknolojilerin bir kısmında yeni ve projeyi mülakatta anlatabilmesi gerekiyor. Bu yüzden:
  - **Alt bölüm başında:** planı 5–10 maddede anlat.
  - **Önemli kararlarda:** ADR yaz ve sohbette sade Türkçeyle 2–3 cümlede açıkla: ne yaptık, neden, hangi alternatifi neden eledik.
  - **Alt bölüm sonunda:** PR'a Türkçe özet yaz. CI yeşilse merge et. Kontrol soruları merge'i engellemez; Enes sorarsa kodun ilgili yerini göstererek açıkla.
  - **Faz sonunda:** `docs/NOTES.md`'yi güncelle (ne yapıldı, neden böyle yapıldı, neler kırılgan). Enes mülakattan önce bunu okuyacak.
- Enes'le samimi Türkçe konuş. Kod, kod yorumları, README ve commit mesajları İngilizce.
- Kapsam dışına çıkma. Yeni bir fikir gelirse park alanına öner ve Enes'e sor.

### Commit kuralı

Bölüm 16 geçerlidir. Özetle: tarihler gerçek; her alt bölüm issue → dal → PR; her alt görev ayrı commit; Conventional Commits; CI yeşilse merge; faz sonunda ayrı `docs:` commit'i ve sürüm etiketi.

### Sohbete başlarken

1. Bu dosyanın tamamını oku.
2. Repoyu incele (işaretli kutucuklar, açık issue/PR'lar, son commit'ler, `docs/NOTES.md`) ve kalınan fazı ve alt bölümü tespit et; Enes'e teyit ettir.
3. Kaldığı yerden, bir alt bölümle devam et.
