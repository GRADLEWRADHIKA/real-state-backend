# EstateFlow backend (API)

This is the server that the **EstateFlow dashboard** (website) and the **EstateFlow app** (Android) both talk to. It holds the database, the logins and the uploaded documents. Start it first; the other two only work while it is running.

```
estateflow-dashboard  ──┐
                        ├──▶  estateflow-backend  (http://localhost:7341, /api/…)
estateflow-app       ───┘
```

The `shared/` folder is the common code (types, rules and API client). The dashboard and the app each carry an identical copy, so every folder installs on its own.

## Before you start

- **Node.js 22.22 or newer.** Install the latest "LTS" version from nodejs.org; Node 24 works too. Check with `node -v`.
- Nothing is compiled during install, so you do **not** need Visual Studio or Python.
- Unzip **outside OneDrive or Dropbox**, for example `C:\projects\estateflow-backend`. Sync tools lock files while `npm install` runs, which causes `EPERM` errors.

## Run it on your computer (demo data)

Windows PowerShell, macOS or Linux:

```bash
cd estateflow-backend
npm install
npm run dev
```

The API is now at http://localhost:7341, with sample data and these logins:

| Role | Email | Password |
|---|---|---|
| Administrator | admin@demo.com | Admin@123 |
| Sales Manager | manager@demo.com | Manager@123 |
| Sales Executive | sales@demo.com | Sales@123 |
| Accounts | accounts@demo.com | Accounts@123 |
| Customer (app only) | customer@demo.com | Customer@123 |

Check it in a browser: http://localhost:7341/api/health shows `{"ok":true,"db":"ok",…}`. Leave this window running and start the dashboard and app in other windows.

`npm run seed:demo` resets the demo data. The demo database is separate from the real one.

## Run it for real (production, empty database)

1. Copy `.env.example` to `.env`. In PowerShell: `Copy-Item .env.example .env`.
2. In `.env`, fill in:
   - `JWT_SECRET`: a long random string of at least 32 characters.
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_NAME`: the first administrator, created on the first start.
   - `CORS_ORIGINS`: the address(es) where the dashboard is hosted, e.g. `https://starwiz-crm.netlify.app`.
3. Run `npm start`.

The database and uploads are saved in `data/` and `uploads/`, and these must be backed up. Production starts empty and refuses a database containing demo data.

If the `estateflow-dashboard` folder sits next to this one and has been built (`npm run build` there), this server also serves the website at http://localhost:7341. In that case you need only one address.

## Put it online

- **Render:** push this folder to a Git repository, then in Render choose New → Blueprint. `render.yaml` sets up the service with a 1 GB disk for `/data`.
- **Docker:** run `docker build -t estateflow-api .`, then `docker run -p 7341:7341 -v estateflow-data:/data -e JWT_SECRET=… -e CORS_ORIGINS=… -e ADMIN_EMAIL=… -e ADMIN_PASSWORD=… estateflow-api`.

Always give it a persistent disk at `/data`, or every redeploy wipes the data. Put it behind HTTPS; the Android app only talks to HTTPS servers.

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Runs the API test suite (106 tests) on throwaway databases |
| `npm run typecheck` | Checks the TypeScript |
| `npm run migrate` | Applies database migrations without starting the server |
| `npm run docs:api` | Regenerates `docs/API.md` |

Every setting is explained in `.env.example`. [docs/API.md](docs/API.md) lists every endpoint, and [docs/ROLES.md](docs/ROLES.md) says who can do what.
