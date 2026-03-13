FROM python:3-slim
RUN pip install psycopg2-binary
COPY leak.py /app/leak.py
CMD ["python", "/app/leak.py"]
