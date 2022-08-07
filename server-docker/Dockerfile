FROM amazoncorretto:11-alpine

LABEL maintainer="oscargolding17@gmail.com"

RUN mkdir -p /minecraft
WORKDIR /minecraft

COPY ./server.zip .

RUN echo 'eula=true' > eula.txt
RUN unzip server.zip && rm -f server.zip

RUN sed -i 's/minRam: 2G/minRam: 6G/g' server-setup-config.yaml
RUN sed -i 's/maxRam: 5G/maxRam: 8G/g' server-setup-config.yaml

CMD ["/bin/sh", "start-server.sh"]