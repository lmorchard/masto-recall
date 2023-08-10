# masto-recall

This is an experimental Mastodon client for personal search & analysis

## Installation

```
npm install
./index --help
```

## Configuration

To list all available configuration settings and current values:
```
./index.js config show
```
TODO: actually document the configuration settings here

## Usage

### Direct

```
npm install
./index --help
```

### Docker

1. Create a new application - e.g. at https://mastodon.social/settings/applications/new
1. Get the client key, client secret, and access token for your new application
1. Build the docker image:
    ```
    docker build -t masto-recall:latest .
    ```
1. Create a directory for data
    ```
    mkdir ./data
    ```
1. Start up the docker container, with your application details supplied in env vars:
    ```
    docker run -d --restart unless-stopped \
        --name masto-recall \
        -p 8089:8089 \
        -v ./data:/data \
        -e 'CLIENT_ID=(your client key here)' \
        -e 'CLIENT_SECRET=(your client secret here)' \
        -e 'ACCESS_TOKEN=(your access token here)' \
        masto-recall:latest
    ```

## TODO

- [ ] add links to search and top links in page header
- [ ] add support for postgresql?
- [ ] Drop Knex and just use plain SQLite module? [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)?
- [ ] Switch to migrations that are just plain SQL up / down files?
- [ ] Split statuses into per-day DBs? one DB gets big too fast?
- [ ] Split links into per-day DBs?
- [ ] Enumerate what questions I want to answer with this project
