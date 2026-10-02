# 多阶段构建：编译出静态二进制，运行在 distroless 镜像里
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/stickydo-server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/stickydo-server /stickydo-server
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/stickydo-server"]
