FROM python:3-slim
WORKDIR /app
# Create data directory as root with restrictive permissions
RUN mkdir -p /app/data && \
    chown root:root /app/data && \
    chmod 700 /app/data
COPY app.py /app/app.py
# Switch to non-root user UID 1000
USER 1000
CMD ["python", "/app/app.py"]
