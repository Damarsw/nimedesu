FROM golang:1.22-alpine AS builder
WORKDIR /app

COPY core/ ./

RUN go mod tidy
RUN go mod download

RUN CGO_ENABLED=0 GOOS=linux go build -o main ./main.go

FROM alpine:latest
WORKDIR /root/
COPY --from=builder /app/main .
EXPOSE 10000
CMD ["./main"]
