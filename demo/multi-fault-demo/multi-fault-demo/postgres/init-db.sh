#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER svcuser WITH PASSWORD 'wr0ngpw';
    GRANT CONNECT ON DATABASE appdb TO svcuser;
    GRANT USAGE ON SCHEMA public TO svcuser;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO svcuser;

    CREATE TABLE IF NOT EXISTS records (
        id SERIAL PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
    );
EOSQL

echo "=== database initialized ==="
