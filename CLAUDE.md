# Liman — Claude Code çalışma kuralları

Repo: https://github.com/Enesyldrm00/Liman-Mini-Pass — tüm commit, dal, PR, issue, etiket ve release bu repoya gider (origin). Başka bir repoya push etme; origin farklıysa dur ve Enes'e sor.

Başlamadan önce docs/ROADMAP.md dosyasını oku (özellikle Bölüm 0, 16 ve sondaki "Ek — Yeni Sohbet İçin Bağlam"). Sonra docs/NOTES.md dosyasını, açık issue/PR'ları ve son commit'leri inceleyip hangi fazda ve alt bölümde kaldığımızı tespit et; Enes'e teyit ettir.

## Kapsam
- Fazları sırayla uygula. Bir fazın "Bitti tanımı" sağlanmadan sonraki faza geçme.
- Kapsam ROADMAP Bölüm 2'de. "Yok" listesindeki hiçbir şeyi ekleme. Yeni fikirleri "Park alanı"na öner; Enes onaylamadan yazma.
- ROADMAP'te karşılığı olmayan bir teknik karar gerekiyorsa seçenekleri kısaca sun, Enes'e sor, kararı ADR'ye yaz.
- ROADMAP ile kod veya ADR çelişirse kod yazma, sor.

## Çalışma ritmi
- Bir oturumda en fazla bir alt bölüm (ör. 1.2 Webhook).
- Kodun tamamını sen yazarsın. Alt bölüm başında planı 5–10 maddede anlat.
- Önemli her kararı sade Türkçeyle 2–3 cümlede açıkla: ne yaptık, neden, neyi neden eledik.
- Kontrol soruları mülakat hazırlığı içindir, ilerlemeyi engellemez. Enes sorarsa kodun ilgili yerini göstererek anlat.

## Git (ROADMAP Bölüm 16)
- main'e doğrudan commit veya push yok. Her alt bölüm için bir issue ve bir dal: `<tip>/<faz.no>-<kisa-ad>` (ör. `feat/1.2-webhook`).
- Her alt görev ayrı commit. Conventional Commits: feat, fix, test, docs, refactor, chore, ci, build. Mesajlar İngilizce ve emir kipinde.
- Commit tarihleri gerçektir; tarih, yazar veya geçmiş değiştirilmez. main'e force push yok.
- Tek istisna: repodaki ilk commit (CLAUDE.md + ROADMAP) bootstrap olarak doğrudan main'e gider. Sonrası hep dal + PR.
- PR'ı `gh` ile aç, şablonu doldur; "Türkçe özet" bölümünde 3–5 satırla ne yapıldığını ve nedenini yaz. CI yeşilse merge et (merge commit, squash yok) ve dalı sil. CI kırmızıysa düzelt, yeniden dene.
- Faz bitince: ROADMAP kutucuklarını işaretle (ayrı `docs:` commit'i), `docs/NOTES.md` güncelle, sürüm etiketi ve release notu (v0.1.0 = Faz 0, v0.2.0 = Faz 1, …).

## Kod
- Kod, kod yorumları, README ve commit mesajları İngilizce. ADR'ler ve NOTES.md Türkçe.
- TypeScript strict; gerekçesiz `any` yok.
- Testi olmayan özellik bitmiş sayılmaz. Zorunlu senaryolar ROADMAP Bölüm 14'te.
- Sırlar loglara yazılmaz. `.env`, anahtar dosyaları ve `secrets/` repoya girmez. `.env.example` her yeni değişkenle güncellenir (Bölüm 15).
- Önemli her mimari karar için `docs/adr/NNNN-baslik.md` yaz (Bağlam, Karar, Elenen alternatifler, Sonuçlar). Planlanan ADR'ler Bölüm 17'de.

## İletişim
- Enes'le samimi Türkçe konuş.
