FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir flask redis
COPY worker.py /app/worker.py
RUN useradd -r -s /bin/false apprunner
RUN mkdir -p /app/spool && chown root:root /app/spool && chmod 700 /app/spool
USER apprunner
EXPOSE 8080
CMD ["python", "/app/worker.py"]
