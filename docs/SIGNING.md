# 代码签名与公证

配置已经写在 `desktop/electron-builder.yml` 里，**没有证书时会自动跳过签名**，构建照常成功。
下面的步骤是在正式分发前要做的三件事。

## Windows（NSIS）

1. 准备证书
   - OV/EV 代码签名证书（`.pfx`），或使用 Azure Trusted Signing
   - EV 证书可立即获得 SmartScreen 信誉；OV 需要累积下载量

2. 用环境变量注入（不要把证书提交进仓库）

   ```powershell
   $env:CSC_LINK = "C:\secrets\codesign.pfx"   # 也支持 base64
   $env:CSC_KEY_PASSWORD = "********"
   npm run dist:win
   ```

   证书已安装到证书存储时，也可以只给主题名：

   ```powershell
   $env:CSC_NAME = "Your Company Ltd."
   ```

3. 校验产物

   ```powershell
   Get-AuthenticodeSignature .\..\release\desktop\EmbeddingGemma2-1.0.0-win-x64.exe |
     Format-List Status, SignerCertificate
   ```

   `Status` 应为 `Valid`；时间戳由 `rfc3161TimeStampServer` 保证证书过期后签名仍有效。

## macOS（DMG）

1. 需要 Apple Developer Program 账号与 **Developer ID Application** 证书（导入钥匙串）
2. 公证（notarization）用 App Store Connect API Key 或 Apple ID：

   ```bash
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
   export APPLE_TEAM_ID="ABCDE12345"
   # electron-builder.yml 里把 mac.notarize 改成 true
   npm run dist:mac
   ```

3. `build/entitlements.mac.plist` 已包含 Electron 所需的最小权限：
   `allow-jit`、`allow-unsigned-executable-memory`、`disable-library-validation`、
   `network.client/server`、`files.user-selected.read-write`。

   > 说明：llama-server 是我们随包携带的子进程，需要 `disable-library-validation`
   > 才能在 hardened runtime 下加载自带的 dylib；如果后续改为独立签名的 helper，
   > 应把它拆成单独的 entitlement 并通过 `entitlementsInherit` 继承。

4. 验证：

   ```bash
   spctl -a -vvv -t install "release/desktop/EmbeddingGemma2-1.0.0-mac-arm64.dmg"
   xcrun stapler validate "release/desktop/EmbeddingGemma2-1.0.0-mac-arm64.dmg"
   ```

## Linux（AppImage）

AppImage 不做代码签名，分发时给出校验和即可：

```bash
npm run dist:linux
sha256sum release/desktop/*.AppImage > release/desktop/SHA256SUMS.txt
```

## CI 建议

| 平台 | runner | 需要的 secrets |
|---|---|---|
| Windows | `windows-latest` | `CSC_LINK`、`CSC_KEY_PASSWORD` |
| macOS | `macos-latest` | `CSC_LINK`(p12)、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` |
| Linux | `ubuntu-latest` | 无 |

构建前都要先跑 `build/build.ps1`（或 `npm --prefix frontend run build`）产出 `release/web`。
