FROM golang:1.22-alpine AS builder

WORKDIR /app

# Salin go.mod
COPY go.mod ./

# Perintah ini akan generate go.sum otomatis & download dependensi secara bersih
RUN go mod tidy

# Salin seluruh file project
COPY . .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o main .

# Stage 2: Runtime Container
FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/main .

EXPOSE 10000

CMD ["./main"]
