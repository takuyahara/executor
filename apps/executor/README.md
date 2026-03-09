# executor

`executor` is a local AI executor with a CLI, a local API server, and a web UI.

It installs as a user command, starts a single local background server, and serves both the API and frontend from that local process.

## Install

```bash
npm install -g executor
```

## Use

```bash
executor doctor --json
executor up
executor status --json
executor down
```

## What it does

- installs a local `executor` command
- stores local app data in standard user directories
- starts one local daemon process
- serves the local API and UI together

## Links

- Repository: https://github.com/RhysSullivan/executor
- Issues: https://github.com/RhysSullivan/executor/issues
