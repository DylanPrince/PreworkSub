# Prince AI OS in GitHub Codespaces

This codespace runs Prince AI OS in **mock mode**: agents produce clearly labelled sample output,
no API key is needed, and nothing is charged.

## 1. Wait for setup

The first start takes several minutes (installing, setting up the database, building). Watch the
terminal at the bottom. You are ready when it says **"Prince AI OS is running (mock mode)."**

## 2. Open the dashboard

1. Click the **Ports** tab next to the terminal.
2. Find port **3000** ("Prince AI OS dashboard").
3. Click the **globe icon** next to it. The dashboard opens in a new browser tab.

Keep the port's visibility **Private** (the default). Only you, signed in to GitHub, can open it.

## 3. Create your account

The **first account you sign up with becomes the owner**. Later sign-ups are refused, so use your
own email and a password you will remember.

## Useful commands

Run these in the terminal:

| What                         | Command                          |
| ---------------------------- | -------------------------------- |
| Check that everything is up  | `bash .devcontainer/status.sh`   |
| Restart the dashboard/worker | `bash .devcontainer/start.sh`    |
| Logs                         | `/tmp/prince-ai-os/web.log`, `/tmp/prince-ai-os/worker.log` |

## Stay safe

- Never make port 3000 **Public**.
- Never commit `prince-ai-os/.env`. It holds your login secret and is already git-ignored.
- **Stop the codespace when you are done** (Codespaces menu, bottom left, then "Stop Current
  Codespace"), so it does not use up your free hours. Your data is kept for next time.
