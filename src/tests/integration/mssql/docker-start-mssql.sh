#!/usr/bin/env sh
set -e

IMAGE_NAME="mcr.microsoft.com/mssql/server"
CONTAINER_NAME="mssql"
IMAGE_FULL_NAME="$IMAGE_NAME:$DOCKER_MSSQL_TAG"

docker pull "$IMAGE_FULL_NAME"

docker run -d --name $CONTAINER_NAME \
  -e ACCEPT_EULA="Y" \
  -e SA_PASSWORD="$TEST_DB_PASSWORD" \
  -p "$TEST_DB_PORT":1433  \
  "$IMAGE_FULL_NAME"

# Wait until database becomes online
until docker logs --tail all ${CONTAINER_NAME} 2>&1 | grep -c "Service Broker manager has started." > /dev/null; do
    echo "Waiting database to become online..."
    sleep 5
done

echo "Database online"

# Create test database
docker exec -i "$CONTAINER_NAME" /opt/mssql-tools/bin/sqlcmd \
  -S localhost \
  -U "$TEST_DB_USERNAME" \
  -P "$TEST_DB_PASSWORD" \
  -Q "CREATE DATABASE $TEST_DB_DATABASE"