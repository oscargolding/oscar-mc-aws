FROM amazoncorretto:11-alpine

LABEL maintainer="oscargolding17@gmail.com"

RUN mkdir -p /minecraft
WORKDIR /minecraft

RUN apk add curl

RUN echo 'eula=true' > eula.txt
RUN curl -L -o server.zip 'https://edge.forgecdn.net/files/3875/470/Enigmatica6Server-1.4.1.zip?api-key=267C6CA3' \
    -H 'authority: edge.forgecdn.net' \
    -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9' \
    -H 'accept-language: en-US;q=0.5' \
    -H 'referer: https://www.curseforge.com/' \
    -H 'sec-fetch-dest: document' \
    -H 'sec-fetch-mode: navigate' \
    -H 'sec-fetch-site: cross-site' \
    -H 'sec-gpc: 1' \
    -H 'upgrade-insecure-requests: 1' \
    -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.134 Safari/537.36' \
    --compressed && unzip server.zip && rm -f server.zip

RUN sed -i 's/minRam: 2G/minRam: 6G/g' server-setup-config.yaml
RUN sed -i 's/maxRam: 5G/maxRam: 8G/g' server-setup-config.yaml

CMD ["/bin/sh", "start-server.sh"]