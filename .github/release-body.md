## macOS 安装说明

macOS 版本使用 ad-hoc 代码签名，但没有 Apple Developer ID 证书，因此无法提交 Apple 公证。首次打开时，macOS 会提示无法验证开发者。

1. 将 One Switch 拖入“应用程序”。
2. 首次打开失败后，进入“系统设置” > “隐私与安全”。
3. 在安全性区域点击“仍要打开”，再次确认“打开”。

下载后可用同目录的 `.dmg.sha256` 文件校验安装包完整性：

```shell
shasum -a 256 -c One\ Switch-*.dmg.sha256
```

除非未来使用 Apple Developer Program 的 Developer ID 证书并完成公证，否则无法消除这一次系统确认。

## 清理应用配置

卸载应用不会自动删除本地配置、API 密钥、请求日志和数据库。需要彻底重置或清理残留数据时，请先退出 One Switch，再删除对应平台的应用数据目录：

- macOS：`~/Library/Application Support/One Switch/`
- Windows：`%APPDATA%\One Switch\`
- Linux：`~/.config/One Switch/`

删除这些目录会清除所有本地设置、已保存的密钥、请求日志和 `one-switch.db`，操作前请确认不再需要其中的数据。
