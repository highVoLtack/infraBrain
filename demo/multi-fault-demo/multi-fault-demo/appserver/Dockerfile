FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir flask psycopg2-binary redis requests
COPY app.py /app/app.py
EXPOSE 5000
CMD ["python", "/app/app.py"]
