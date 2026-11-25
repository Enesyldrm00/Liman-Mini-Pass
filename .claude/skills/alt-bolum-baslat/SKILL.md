---
name: alt-bolum-baslat
description: Bir ROADMAP alt bölümünü başlatır. Kalınan yeri teyit ettirir, 5–10 maddelik plan çıkarır, onaydan sonra issue ve dalı hazırlar. Kod yazmaz.
argument-hint: "[faz.no, ör. 0.4]"
disable-model-invocation: true
---

# Alt bölüm başlat: $ARGUMENTS

CLAUDE.md ve ROADMAP Bölüm 16 geçerlidir. main'e doğrudan commit veya push yok. Bu skill **kod yazmaz**.

`gh` PATH'te yoksa `"/c/Program Files/GitHub CLI/gh.exe"` yolunu kullan.

## 1. Oku

- `docs/ROADMAP.md`: `$ARGUMENTS` alt bölümünün kutucukları, fazın "Bitti tanımı", ilgili bölümler (7, 8, 13, 14, 15, 17).
- `docs/NOTES.md` (varsa).
- `git status`, `git log --oneline -15`, `gh issue list --state open`, `gh pr list`.

## 2. Teyit ettir

- Önceki alt bölümlerin PR'ı merge edilmiş mi, açık PR veya yarım dal var mı? Varsa **dur** ve Enes'e söyle.
- Çalışma alanı temiz mi, main güncel mi?
- Enes'e tek cümleyle sor: "Faz X, alt bölüm `$ARGUMENTS` ile devam ediyoruz, doğru mu?"

## 3. Plan

5–10 madde, sade Türkçe:

- Ne yapılacak (her kutucuk karşılanıyor mu)
- Planlanan commit'ler (Conventional Commits, İngilizce, emir kipi)
- Gerekli testler (Bölüm 14'teki zorunlu senaryolar dahil)
- Gereken ADR (Bölüm 17) ve `.env.example` değişiklikleri
- ROADMAP'te karşılığı olmayan teknik karar varsa: seçenekleri kısaca sun, sor
- Kapsam dışı (Bölüm 2 "Yok") hiçbir şey yok; yeni fikir varsa "Park alanı" önerisi olarak ayır

**Enes onaylayana kadar bekle.**

## 4. Onaydan sonra

- Issue: bu alt bölüm için açık issue varsa onu kullan. Yoksa `.github/ISSUE_TEMPLATE/subsection.md` biçiminde aç:
  - Başlık: `<faz.no> <Ad>`
  - Görev listesi: ROADMAP kutucukları
  - Etiketler: `faz-N`, uygun `area/*` ve `type/*`
- Dal: güncel main'den `<tip>/<faz.no>-<kisa-ad>` (ör. `feat/0.4-database`).
- Issue numarasını ve dal adını bildir. Kodlamaya Enes "başla" deyince geç.
