#!/bin/sh
# Скачивает картинки для главной страницы (сгенерированы в Higgsfield)
cd "$(dirname "$0")" && mkdir -p public/img
curl -fsSL -o public/img/hero.png  "https://d8j0ntlcm91z4.cloudfront.net/user_3LH0JF948tVY6J9ZGKTq9ZtxGsj/hf_20261124_132724_53a119d4-c580-458e-80f0-148eedebaecf.png"
curl -fsSL -o public/img/scene.png "https://d8j0ntlcm91z4.cloudfront.net/user_3LH0JF948tVY6J9ZGKTq9ZtxGsj/hf_20261124_132734_0bc8189f-2d94-463e-8ba6-862219154dc6.png"
ls -lh public/img
