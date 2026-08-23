FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod ./

# Jalankan go mod download dengan flag -insecure / bypass
RUN go mod download

COPY . .

# Tambahkan flag -mod=mod agar Go membuat/memperbarui daftar dependency saat build tanpa menuntut go.sum
RUN CGO_ENABLED=0 GOOS=linux go build -mod=mod -ldflags="-w -s" -o main .

FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/main .

EXPOSE 10000

CMD ["./main"]
