# 多阶段构建：Vite 打包出静态文件，由 nginx 提供，并把 /api 转给 Go 服务
# 构建上下文是仓库根目录（web 依赖 packages/core）：docker build -f web/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY web/package.json web/
RUN npm ci
COPY packages packages
COPY web web
RUN npm run build -w web

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/web/dist /usr/share/nginx/html
EXPOSE 80
