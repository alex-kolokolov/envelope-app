# Starter base

A starting point to help you set up your project quickly and use the common components provided by `react-native-reusables`. The idea is to make it easier for you to get started.

## Features

- NativeWind v4
- Dark and light mode
  - Android Navigation Bar matches mode
  - Persistent mode
- Common components
  - ThemeToggle, Avatar, Button, Card, Progress, Text, Tooltip

<img src="https://github.com/mrzachnugent/react-native-reusables/assets/63797719/42c94108-38a7-498b-9c70-18640420f1bc"
     alt="starter-base-template"
     style="width:270px;" />

---

## Использование собранной web-версии (папка dist) для backend

1. Соберите фронтенд:
   ```bash
   npm install
   npm run build
   ```
   После этого появится папка `dist` с собранной web-версией.

2. Скопируйте содержимое папки `dist` на сервер, где развернут backend.

3. Настройте backend для отдачи статических файлов из папки `dist`:
   - **Node.js (Express):**
     ```js
     const express = require('express');
     const path = require('path');
     const app = express();

     // Раздача статики
     app.use(express.static(path.join(__dirname, 'dist')));

     // Для SPA: отдавать index.html на все остальные маршруты
     app.get('*', (req, res) => {
       res.sendFile(path.join(__dirname, 'dist', 'index.html'));
     });

     // ... остальной backend-код
     ```

   - **nginx:**
     ```nginx
     server {
       listen 80;
       server_name example.com;

       root /path/to/dist;
       index index.html;

       location / {
         try_files $uri $uri/ /index.html;
       }
     }
     ```

4. После этого фронтенд будет доступен по тому же адресу, что и backend, либо на отдельном домене/поддомене — в зависимости от настроек.

---
