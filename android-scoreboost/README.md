# 念念 AI 提分 Android APK

这是当前念念 AI 提分应用的 Android WebView 外壳。APK 本身不包含模型服务；它默认连接正式的念念服务 `https://tutor.cauai.fun`。

## 构建

在安装 Android SDK 和 Gradle 后，从本目录运行。默认生成的 APK 连接正式服务；本地开发时再显式传入 `-PdeeptutorUrl`：

```powershell
gradle :app:assembleDebug
```

生成文件位于 `app/build/outputs/apk/debug/app-debug.apk`。

## 使用边界

- 首次启动会直接打开“今日任务”；账号登录和学习记录由正式网站统一保存。
- 正式构建只接受 HTTPS 内容，不允许加载明文 HTTP 页面或混合内容。
- App 会在网页请求录音时申请 Android 麦克风权限；拒绝后可继续拍题或文字作答。
- App 支持网页的相册/文件选择和返回页逻辑。Android 真机仍须在发布前验证拍照、相册、首次录音授权、拒绝后重试、登录保持与全面屏安全区。
