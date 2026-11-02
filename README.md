# 反内耗指数测试

一个可商用的趣味测评网站：密码验证 → 30 题测评 → 结果长图 / 分享链接 / 再测一次 / 好评有礼，
另附密码管理后台（批量生成、用量统计、停用与重置）。

- 前端：纯静态 HTML/CSS/JS，托管在 **GitHub Pages**
- 后端与数据库：**Supabase**（Postgres + Auth + RLS）
- 无构建步骤、无 npm 依赖，所有第三方库已放在 `js/vendor/` 内

## 目录

```
index.html                 测评页
admin.html                 管理后台（需管理员邮箱密码登录）
css/style.css
js/env.js                  ← 唯一需要填写的文件：Supabase URL 与 anon key
js/config.js               业务开关与弹窗文案
js/data.js                 题库、维度、9 种结果人格文案
js/app.js                  测评主流程
js/admin.js                后台逻辑
js/vendor/supabase.js      Supabase 浏览器 SDK
js/vendor/html2canvas.min.js  结果长图生成
.github/workflows/keepalive.yml   可选：防止 Supabase 免费项目休眠
```

## 部署

完整图文步骤见项目上级目录的 **`部署指南.html`**（含一键复制建表 SQL、生成 `js/env.js`）。

简要顺序：

1. Supabase 新建项目 → SQL Editor 执行 `supabase_schema.sql`（指南第 3 步可一键复制）
2. Authentication 添加管理员用户（勾选 Auto Confirm User），并关闭公开注册
3. 执行 `update public.admin_config set value='管理员邮箱' where key='admin_email';`
4. Settings → API 复制 Project URL 与 **anon public / publishable key**，生成并覆盖 `js/env.js`
5. GitHub 新建 Public 仓库 → 上传本目录全部文件 → Settings → Pages → main / root
6. 访问 `https://<用户名>.github.io/<仓库名>/` 与 `/admin.html`

⚠️ **只能把 anon / publishable key 写进 `js/env.js`。**
`service_role` / `secret key` 会绕过所有行级权限，绝不能出现在公开仓库里。

## 权限模型

| 角色 | 能做什么 |
|---|---|
| 游客（anon） | 调用 `consume_license()` 消耗一次密码；向 `results` 插入自己的结果；用分享码通过 `get_result()` 读取单条结果 |
| 管理员（authenticated + `is_admin()`） | 读写 `licenses`、统计 `results` |
| 任何人 | 读不到 `licenses` 整表，也读不到 `admin_config` |

`consume_license()` 使用 `FOR UPDATE` 行锁，保证并发下不会超发次数。

## 本地预览

本目录是纯静态站点，用任意静态服务器打开即可，例如：

```
python -m http.server 8123
```

然后访问 `http://127.0.0.1:8123/index.html` 与 `/admin.html`。
（直接双击打开 `file://` 也能看页面，但剪贴板与跨源请求行为受限，建议用本地服务器。）

## 合规提示

结果为娱乐化自我认知内容，非临床诊断依据；请勿在文案中使用疾病名称、诊断或治疗表述。
