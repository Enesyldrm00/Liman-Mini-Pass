# 0003 — Oturum yönetimi, çerez ve CSRF stratejisi

- Durum: Kabul edildi
- Tarih: 2026-11-25
- Faz: 0

## Bağlam

0.7'de panel girişi GitHub App kullanıcı yetkilendirmesiyle yapılıyor. ROADMAP şunları sabitliyordu: oturumlar `sessions` tablosunda, token DB'de yalnızca SHA-256 özetiyle; çerez httpOnly ve SameSite=Lax, üretimde Secure ve `__Host-` önekli; durum değiştiren isteklerde Origin kontrolü; giriş ucunda hız sınırı; izin listesi GitHub kullanıcı ID'siyle (Bölüm 7, 10, 13).

Açık kalan sorular:

1. Oturum süresi sabit mi olsun, her istekte uzasın mı?
2. Hız sınırı sayacı nerede tutulsun?
3. Kardeş subdomain'deki bir kullanıcı uygulamasından gelen CSRF'e karşı SameSite yeter mi?
4. API Traefik'in arkasında; istemci IP'si nasıl okunacak?

Panel ve API aynı origin'de (`liman.localhost`, API `/api` altında). Kullanıcı uygulamaları ise `<sub>.localhost` (üretimde `<sub>.alanadi.com`) adreslerinde çalışıyor; tarayıcı bunları panelle **aynı site** sayıyor.

## Karar

- **Token:** 32 rastgele bayt (base64url). Çerezde ham token, DB'de `sha256(token)` hex. DB sızsa bile oturum çalınamaz.
- **Sabit süre:** Oturum, açıldığı andan `SESSION_TTL_HOURS` (varsayılan 168) saat sonra biter; kullanım süreyi uzatmaz. `last_seen_at` yalnızca bilgi içindir ve en fazla 5 dakikada bir yazılır. Süresi dolmuş oturum ilk istekte silinir; aynı kullanıcı tekrar giriş yaptığında da eski, süresi dolmuş satırları temizlenir.
- **Çerezler:** Oturum (`liman_session`) ve OAuth `state` (`liman_oauth_state`, 10 dakika) çerezleri httpOnly, SameSite=Lax ve `Path=/`; `Domain` yok. Üretimde Secure ve adları `__Host-` önekli. `state` çerezi callback'te her durumda silinir (tek kullanımlık). Lax, GitHub'dan dönen üst düzey yönlendirmede çerezin gelmesini sağlar; Strict bunu engellerdi.
- **PKCE (S256):** Giriş başlarken `state` ile birlikte rastgele bir `code_verifier` üretilir; GitHub'a yalnızca SHA-256 özeti (`code_challenge`) gider. İkisi tek bir httpOnly çerezde (`<state>.<verifier>`) taşınır. Böylece sızan bir `code`, verifier olmadan token'a çevrilemez. GitHub App web akışı PKCE'yi Temmuz 2025'ten beri destekliyor.
- **Callback:** Önce `state` çerezdekiyle sabit zamanlı karşılaştırılır; tutmazsa 400 ve GitHub'a hiç gidilmez (giriş CSRF'i). Ardından tarayıcıda giriş öncesinden kalan bir oturum varsa silinir (session fixation); bu, GitHub'a gitmeden önce yapılır ki reddedilen bir giriş eski hesabı açık bırakmasın. Sonra `code` verifier ile token'a çevrilir, `GET /user` ile kullanıcı alınır ve token atılır. GitHub'a ulaşılamazsa ya da zaman aşımı olursa kullanıcı `?login_error=github_failed` ile panele döner. İzin listesinde olmayan ID için `users` satırı açılmaz.
- **İzin listesi her istekte:** Listeden çıkarılan bir kullanıcının mevcut oturumları bir sonraki istekte silinir; bir sonraki girişi beklemez.
- **Origin kontrolü:** `/api` altındaki GET, HEAD ve OPTIONS dışındaki her istekte `Origin` başlığı `LIMAN_PUBLIC_URL` ile birebir aynı olmalı. Eksik, `null` ya da farklıysa 403. Webhook ucu (1.2) GitHub'dan geldiği için bu kontrolden muaf tutulacak ve kendi HMAC doğrulamasına dayanacak.
- **Hız sınırı:** Giriş ve callback uçları için IP başına dakikada 10 istek, Redis'te sabit pencereli sayaç (`SET NX EX` + `INCR`, tek MULTI içinde). Aşılınca 429 ve `Retry-After`. Redis'e ulaşılamazsa istek 500 ile düşer, sınır atlanmaz; istemci (`maxRetriesPerRequest: 1`, `commandTimeout: 2000`) komutu kuyrukta bekletmez, istek askıda kalmaz. IPv6 adresleri /64 önekine göre sayılır, çünkü bir istemci genelde bütün bir /64'ü kullanabilir.
- **İstemci IP'si:** Express'te `trust proxy = 1`. Önde tam bir vekil (Traefik) olduğu için `req.ip`, `X-Forwarded-For`'daki son adrestir; istemcinin başa eklediği sahte adresler dikkate alınmaz.
- **Üretimde https zorunlu:** `NODE_ENV=production` iken `LIMAN_PUBLIC_URL` https değilse API açılmaz. `__Host-` öneki ve Secure yalnızca https'te çalışır.
- **Hata logları:** Başarısız bir veritabanı sorgusu loga yalnızca Postgres hata kodu ve kısıt/tablo/sütun adıyla yazılır. Drizzle hata mesajı SQL parametrelerini, Postgres `detail` alanı satır değerlerini içerir.

## Elenen alternatifler

- **Kayan süre (her istekte uzayan oturum):** Aktif kullanılan bir oturum hiç bitmez; çalınan bir çerez de süresiz geçerli kalır. Tek kullanıcılı bir panelde haftada bir yeniden giriş küçük bir bedel.
- **Sadece SameSite'a güvenmek:** Kardeş subdomain'deki bir uygulama panelle aynı sitedir. Oradan gönderilen bir form, Lax çerezle birlikte gider. Origin karşılaştırması bu yüzden zorunlu.
- **CSRF token (senkronize token deseni):** Panel ve API aynı origin'de olduğu ve tarayıcılar Origin'i her zaman gönderdiği için ek token ve onu taşıma mantığı gereksiz karmaşa olurdu. Origin, sayfa tarafından taklit edilemez.
- **Bellekte hız sınırı (`express-rate-limit` varsayılanı):** API yeniden başlayınca sıfırlanır ve birden fazla kopya çalışırsa her kopya ayrı sayar. Redis zaten yığında var; Faz 1'de BullMQ için de kullanılacak.
- **JWT ile durumsuz oturum:** Sunucu tarafında iptal (logout, izin listesinden çıkarma) için yine bir liste gerekir. DB'deki oturum satırı bunu doğrudan sağlıyor.
- **Kullanıcı token'ını saklamak:** Repo erişimi installation token ile yapılacak (0.8). Saklanan bir kullanıcı token'ı yalnızca sızıntı riski getirirdi.
- **`trust proxy = true`:** `X-Forwarded-For`'daki ilk adres kullanılırdı; istemci kendi IP'sini seçip hız sınırını aşabilirdi.

## Sonuçlar

- Giriş akışı, oturum ve CSRF önlemleri entegrasyon testleriyle (gerçek Postgres ve Redis, sahte GitHub) doğrulanıyor; Bölüm 14'teki "Origin hatalı POST → 403" senaryosu dahil.
- **Bedel:** Kullanıcı en geç `SESSION_TTL_HOURS` sonra yeniden giriş yapar. API, Redis olmadan giriş kabul etmez.
- **Kabul edilen risk:** Geliştirmede (`http`) `__Host-` öneki kullanılamıyor; kardeş subdomain'den çerez enjeksiyonu yalnızca üretimde engelleniyor. İdeal çözüm kullanıcı uygulamalarını ayrı bir kayıtlı alan adında tutmak (Bölüm 13); Faz 4'te yeniden değerlendirilir.
- **Kabul edilen risk:** Sabit pencereli sayaç, pencere sınırında kısa süreliğine iki katı isteğe izin verebilir. Giriş ucu için yeterli.
- **Kabul edilen risk:** API host'ta (`pnpm dev`, önünde Traefik olmadan) çalışırken `X-Forwarded-For` istemcinin kendi yazdığı değerdir; hız sınırı orada atlatılabilir. Yalnızca yerel geliştirmeyi etkiler; compose'da API portu dışarı açılmaz ve Traefik gelen `X-Forwarded-For`'u kendisi yazar.
- **İleride:** `trust proxy` değeri vekil sayısına bağlı; Faz 2'de k3s'teki Traefik önünde ek bir katman (ServiceLB) olup olmadığı yeniden doğrulanmalı. Önüne ikinci bir vekil (ör. bulut yük dengeleyicisi) gelirse bu değer ve bu ADR güncellenmeli. Kullanıcı token'ı şu an atılıyor ama GitHub'da süresi dolana kadar (8 saat) geçerli; 0.8'de girişte installation senkronu yapıldıktan sonra `DELETE /applications/{client_id}/token` ile iptal edilecek. 0.8'de `installation_id` doğrulaması kullanıcı token'ı gerektirirse token'ın callback içinde nasıl kullanılacağı ADR-0002'de yazılır.
