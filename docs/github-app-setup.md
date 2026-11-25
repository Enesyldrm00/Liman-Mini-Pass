# GitHub App setup (development)

Liman talks to GitHub through a **GitHub App**, not an OAuth App: it signs users in with the App's user authorization, reads repositories with short-lived installation tokens and receives webhooks for the repositories the App is installed on. Development uses its own App, `liman-dev`, so nothing here touches a production App.

This guide creates the App, stores its credentials outside the repository and checks that GitHub can deliver webhooks. It takes about ten minutes.

## Values used below

| Setting         | Value                                             |
| --------------- | ------------------------------------------------- |
| App name        | `liman-dev` (must be unique on GitHub)            |
| Homepage URL    | `https://github.com/Enesyldrm00/Liman-Mini-Pass`  |
| Callback URL    | `http://liman.localhost/api/auth/github/callback` |
| Setup URL       | `http://liman.localhost/api/github/setup`         |
| Webhook URL     | your smee.io channel (step 1)                     |
| Private key     | `secrets/app.pem`                                 |
| Who can install | Only this account                                 |

The callback and setup URLs point at the local stack (`pnpm stack:up`), where Traefik sends `liman.localhost/api/*` to the API. The endpoints themselves arrive in later steps: sign-in in 0.7, installation setup in 0.8, the webhook receiver in 1.2. Until then GitHub can redirect to them, but the API answers 404.

## 1. Create a smee.io channel

GitHub cannot reach `localhost`, so in development webhooks go through [smee.io](https://smee.io), which relays them to a local client.

1. Open <https://smee.io/new>. You land on a channel page; its address is your channel URL (`https://smee.io/<random>`).
2. Keep the tab open: deliveries show up there live.

Treat the channel URL as private. Anyone who has it can read the payloads (repository names, commit messages). They cannot forge deliveries that Liman accepts, because every delivery is signed with the webhook secret and Liman checks that signature (ROADMAP section 13). The URL goes only into `.env`, never into a committed file.

The local client that forwards the channel to the API is added in 1.2, together with the webhook endpoint. For this step the channel page is enough.

## 2. Create the App

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** (<https://github.com/settings/apps/new>) and fill in the form from top to bottom.

**Basic information**

- **GitHub App name:** `liman-dev`. If the name is taken, pick another one and use it as `GITHUB_APP_SLUG` later.
- **Homepage URL:** `https://github.com/Enesyldrm00/Liman-Mini-Pass`

**Identifying and authorizing users**

- **Callback URL:** `http://liman.localhost/api/auth/github/callback`
- **Expire user authorization tokens:** leave checked. Liman uses the user token only once at sign-in and never stores it.
- **Request user authorization (OAuth) during installation:** leave **unchecked**. When it is checked, GitHub disables the Setup URL and sends users to the callback URL after installing. Liman needs the setup redirect to verify the new `installation_id` against the user's installations (0.8).
- **Enable Device Flow:** leave unchecked.

**Post installation**

- **Setup URL:** `http://liman.localhost/api/github/setup`
- **Redirect on update:** check it, so changing the repository selection later also returns to Liman.

**Webhook**

- **Active:** checked.
- **Webhook URL:** your smee.io channel URL.
- **Webhook secret:** generate a random value and keep it for `.env`:

  ```sh
  openssl rand -hex 32
  ```

- **SSL verification:** leave enabled.

**Permissions**

Repository permissions:

| Permission | Access    | Why                                          |
| ---------- | --------- | -------------------------------------------- |
| Contents   | Read-only | Clone the repository at a commit; `push` events |
| Metadata   | Read-only | List repositories and branches (mandatory)   |

Leave every other repository, organization and account permission at **No access**. Liman never writes to GitHub.

**Subscribe to events**

- Check **Push**. The option appears once Contents is set to read.
- `installation` and `installation_repositories` have no checkbox: GitHub sends them to every App that has an active webhook. Liman uses them to keep installations in sync (1.2).

**Where can this GitHub App be installed?**

- Choose **Only on this account**.

Click **Create GitHub App**.

## 3. Collect the credentials

On the App's **General** page:

1. Note the **App ID** and the **Client ID**.
2. Under **Client secrets**, click **Generate a new client secret** and copy it right away; GitHub shows it once.
3. Under **Private keys**, click **Generate a private key**. A `.pem` file is downloaded. Move it into the repository's `secrets/` directory:

   ```sh
   mkdir -p secrets
   mv ~/Downloads/liman-dev.*.private-key.pem secrets/app.pem
   ```

`secrets/`, `*.pem` and `.env` are git-ignored. Confirm before committing anything:

```sh
git check-ignore -v secrets/app.pem .env
```

Both paths must be listed. If one is missing, stop and fix `.gitignore` first.

## 4. Fill in `.env`

Copy `.env.example` to `.env` if you have not yet, then set:

| Variable                      | Where it comes from                   |
| ----------------------------- | ------------------------------------- |
| `GITHUB_APP_ID`               | App ID (step 3)                       |
| `GITHUB_APP_SLUG`             | The App name in its URL, `liman-dev`  |
| `GITHUB_APP_CLIENT_ID`        | Client ID (step 3)                    |
| `GITHUB_APP_CLIENT_SECRET`    | Client secret (step 3)                |
| `GITHUB_APP_PRIVATE_KEY_PATH` | `./secrets/app.pem`                   |
| `GITHUB_WEBHOOK_SECRET`       | The value generated in step 2         |
| `SMEE_URL`                    | Your smee.io channel URL (step 1)     |
| `LIMAN_ALLOWED_GITHUB_IDS`    | Your numeric GitHub user ID, see below |

The allow list holds **numeric user IDs**, not logins, because a login can be renamed and then taken by someone else. Find yours with:

```sh
gh api user --jq .id
# or, without gh:
curl -s https://api.github.com/users/<your-login> | grep '"id"'
```

The API and worker read these variables once the code that needs them exists (0.7 and later). Nothing reads them yet.

## 5. Check webhook delivery

GitHub sends a `ping` event as soon as the App is created.

1. On the smee.io channel page you should see a delivery with the header `x-github-event: ping`.
2. In the App settings, open **Advanced → Recent Deliveries**. The `ping` delivery should be listed with a green tick and response `200` (that is smee's answer).

If the ping is missing, check the Webhook URL and that **Active** is checked, then use **Redeliver** on the delivery.

## 6. Install the App

1. Open **Install App** in the App settings (or `https://github.com/apps/liman-dev/installations/new`).
2. Install it on your account, on **Only select repositories** with at least one repository you want to deploy, for example `liman-sample-app`.
3. GitHub redirects to the Setup URL with `installation_id` and `setup_action=install` in the query string. Until 0.8 the API answers 404; that is expected.
4. The smee.io channel shows an `installation` delivery with `action: created`.

Changing the repository selection later sends an `installation_repositories` delivery.

## Rotating credentials

- **Private key:** generate a new key, replace `secrets/app.pem`, restart api and worker, then delete the old key on GitHub.
- **Client secret:** generate a new one, update `.env`, restart the API, delete the old one.
- **Webhook secret:** change it on GitHub and in `.env` together; deliveries signed with the other value are rejected while they differ.

A leaked key or secret is rotated right away, before anything else.
