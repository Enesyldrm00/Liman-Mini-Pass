---
name: faz-kapat
description: Bir fazı kapatır. Bitti tanımını madde madde kontrol eder; eksik yoksa kutucukları işaretler, NOTES.md'yi derler, onaydan sonra sürüm etiketi ve release notu yayınlar.
argument-hint: "[faz no, ör. 0]"
disable-model-invocation: true
---

# Faz kapat: Faz $ARGUMENTS

CLAUDE.md ve ROADMAP Bölüm 16 geçerlidir. main'e doğrudan commit veya push yok. Etiket ve release Enes'in açık onayı olmadan atılmaz.

`gh` PATH'te yoksa `"/c/Program Files/GitHub CLI/gh.exe"` yolunu kullan.

Sürümler: Faz 0 → `v0.1.0`, Faz 1 → `v0.2.0`, Faz 2 → `v0.3.0`, Faz 3 → `v0.4.0`, Faz 4 → `v1.0.0`.

## 1. Kontrol

- ROADMAP'te Faz `$ARGUMENTS` için iki şeye bak:
  - Tüm alt bölümlerin PR'ları merge edilmiş mi?
  - Alt bölüm issue'ları kapanmış mı?
- "Bitti tanımı"nı madde madde kontrol et. Her madde için kanıt göster: dosya, test, komut çıktısı ya da PR.
- Elle denenmesi gerekenleri ayrı bir liste yap. Örnek: `docker compose up`, GitHub ile giriş. Enes'e "denedin mi?" diye sor.
- Fazın ADR'leri (Bölüm 17) yazılmış olmalı.
- **Bir madde bile eksikse:** eksikleri listele ve **dur**. Başka hiçbir şey yapma.

## 2. Kapanış dalı (her şey tamamsa)

- Güncel main'den `docs/<faz>-close` dalı aç (ör. `docs/0-close`).
- Commit 1, `docs: check off phase <N> in roadmap`: yalnızca Faz `$ARGUMENTS`'ın kutucuklarını işaretle.
- Commit 2, `docs: add phase <N> notes`: `docs/NOTES.md`'de "Taslak notlar"dan Faz bölümünü derle. İçerik:
  - ne yapıldı
  - neden böyle yapıldı
  - neler kırılgan
  - kontrol sorularının kısa cevapları

  Derlenen taslakları kaldır.

- PR aç ve merge et (`/alt-bolum-bitir`'deki 4. ve 5. adımlarla aynı kural).

## 3. Etiket ve release (onay şart)

- Release notu taslağını hazırla. Faz özeti ve son etiketten bu yana `git log --oneline` çıktısı Conventional Commits türlerine göre gruplanır.
- Etiket adını ve notu Enes'e göster. Sor: "Etiketi atıp release'i yayınlayayım mı?"
- **Onay gelirse:**
  - `git switch main && git pull --ff-only`
  - `git tag -a vX.Y.Z -m "Phase <N>"`
  - `git push origin vX.Y.Z`
  - `gh release create vX.Y.Z --title "vX.Y.Z — Phase <N>" --notes-file <geçici dosya>`
- Onay gelmezse etiket atma. Taslağı bırak.
