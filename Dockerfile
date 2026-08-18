FROM golang:1.22-alpine AS builder

WORKDIR /app

# Hanya salin go.mod saja agar tidak error malformed/missing go.sum
COPY go.mod ./

# Download dependensi tanpa bergantung pada go.sum manual
RUN go mod download

# Salin seluruh isi source code project
COPY . .

# Build binary aplikasi
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o main .

# Stage 2: Container final yang ringan
FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/main .

EXPOSE 10000

CMD ["./main"]
