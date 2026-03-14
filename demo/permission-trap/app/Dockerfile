FROM python:3-slim
WORKDIR /app
ARG DATA_DIR=/app/data
ENV DATA_DIR=${DATA_DIR}
# Create data directory as root with restrictive permissions
RUN mkdir -p ${DATA_DIR} && \
    chown root:root ${DATA_DIR} && \
    chmod 700 ${DATA_DIR}
COPY app.py /app/app.py
# Switch to non-root user UID 1000
USER 1000
CMD ["python", "/app/app.py"]
