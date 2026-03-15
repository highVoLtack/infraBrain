FROM python:3-slim
WORKDIR /app
ARG LOG_DIR=/app/logs
ENV LOG_DIR=${LOG_DIR}
# Create log directory on a tiny tmpfs (2MB) so it fills up fast
RUN mkdir -p ${LOG_DIR}
COPY app.py /app/app.py
CMD ["python", "/app/app.py"]
