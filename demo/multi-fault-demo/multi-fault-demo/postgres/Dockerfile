FROM postgres:16-alpine
COPY init-db.sh /docker-entrypoint-initdb.d/01-init-db.sh
RUN chmod +x /docker-entrypoint-initdb.d/01-init-db.sh
