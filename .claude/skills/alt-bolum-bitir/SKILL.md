---
name: alt-bolum-bitir
description: Mevcut alt bölüm dalını bitirir. Kontrolleri çalıştırır, NOTES.md'ye taslak not ekler, PR açar, kurala uygunsa squash merge ile birleştirir ve dalı siler.
argument-hint: "[issue no (opsiyonel)]"
disable-model-invocation: true
---

# Alt bölüm bitir

CLAUDE.md ve ROADMAP Bölüm 16 geçerlidir. main'e doğrudan commit veya push yok. Force push yok. PR'lar squash merge ile birleşir; main'de her alt bölüm tek commit olur.

`gh` PATH'te yoksa `"/c/Program Files/GitHub CLI/gh.exe"` yolunu kullan.

## 1. Ön kontrol

- Mevcut dal main değil ve `<tip>/<faz.no>-<kisa-ad>` biçiminde olmalı. Çalışma alanı temiz olmalı.
- Issue numarası: `$ARGUMENTS` verildiyse onu kullan. Verilmediyse `gh issue list` içinden alt bölüme göre bul.

## 2. Kontroller (biri kırmızıysa dur, düzelt, baştan al)

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`
- Testler Bölüm 14'teki ilgili zorunlu senaryoları karşılıyor mu? Eksik varsa listele ve dur.
- Sırlar: `git diff main...HEAD --name-only` içinde `.env`, `secrets/` ya da `*.pem` olmamalı. Diff'te token veya anahtar olmamalı.
- Yeni ortam değişkeni eklendiyse `.env.example` güncel olmalı (Bölüm 15).
- Gereken ADR yazılmış olmalı (Bölüm 17).
- Enes'e öner: PR'dan önce `liman-reviewer` ve `security-auditor` agent'ları çalıştırılsın mı?

## 3. Notlar

- **ROADMAP kutucuklarını işaretleme.** Bu işi faz sonunda `/faz-kapat` yapar.
- `docs/NOTES.md` dosyasında "Taslak notlar" başlığı altına bu alt bölüm için 3–5 satır Türkçe not ekle: ne yapıldı, neden, neler kırılgan. Dosya yoksa oluştur.
- Notları ayrı bir commit'le ekle: `docs: add notes for <faz.no>`.

## 4. PR

- `git push -u origin <dal>`
- `gh pr create` ile `.github/pull_request_template.md` şablonunu doldur:
  - `Closes #<issue>`
  - What, Why (ilgili ADR), How tested (komutlar)
  - **Türkçe özet:** 3–5 satır, ne yapıldı ve neden
- Claude için attribution satırı ekleme (`.claude/settings.json` → `attribution`).

## 5. Merge

- `gh pr checks` çalıştır:
  - Check varsa hepsi yeşil olana kadar bekle. Kırmızıysa düzelt, push et, tekrar bekle.
  - Hiç check yoksa (CI 0.10'da gelecek): 2. adımdaki lokal kontroller geçtiyse devam et. PR'a "CI not set up yet (0.10); local lint, typecheck, test and format checks passed." yorumunu yaz.
- Squash mesajını hazırla; GitHub'ın varsayılanı dal commit'lerini (ve içlerindeki eski trailer'ları) mesaja doldurur, ona bırakma:
  - Konu: Conventional Commits, İngilizce, sonunda alt bölüm no'su. Ör. `feat(api): GitHub installations and repo listing (0.8)`.
  - Gövde: PR'daki önemli maddelerden 3–6 kısa madde. Son satır `Closes #<issue>`. Co-author satırı yok.
- `gh pr merge --squash --delete-branch --subject "<konu>" --body "<gövde>"`
- `git switch main && git pull --ff-only`, ardından lokal dalı sil.
- Enes'e PR linkini ve iki cümlelik özeti ver. Fazın son alt bölümüyse `/faz-kapat` öner.
