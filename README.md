## This is a POC project for showcasing caching with redis for next pages.

### Prerequisites
Redis should be installed using docker.

#### Instructions

Retrieve and start a Redis container (my-redis) with the docker run command:

```
docker run --name my-redis -d redis
```
Once the installation process is complete, check the status of current docker containers with the docker ps command:

```
docker ps
```

### Request caching pipeline
1. Client requests a page from express.js server
2. Server checks if request is from bot or not

    If bot is requesting check the bot page cache ( prefixed with bot-{url} )
    If there is result, it gets returned
    if there is no result, the page is renderened to not include scripts.

3. if normal user is requesting check the user cache ( prefixed with user-{url} )
    If there is result, it gets returned
    if there is no result, the page is cached and renderened
