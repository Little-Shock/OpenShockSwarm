# Headed Message Send Flow Report

- Generated at: 2026-04-13T13:44:07.242Z
- Web URL: http://127.0.0.1:44330
- Control URL: http://127.0.0.1:44678

## Checks
- 频道发送后，人类消息会先出现在消息流里，同时显示“发送中”和“正在生成回复...” -> PASS
- 频道发送请求返回 200，返回状态里已经带回新的会话内容 -> PASS
- 频道消息在离开再返回后仍然保留，说明不是只在本地临时渲染 -> PASS
- 讨论间发送后，人类消息会先落到流里，按钮和回复占位会一起进入发送态 -> PASS
- 讨论间流式请求已经建立，服务端开始返回消息流 -> PASS
- 讨论间消息在切换讨论间再返回后仍可见，说明流式回写已经真正落到状态里 -> PASS

## Screenshots
- channel-send-finished: ../../../../../tmp/openshock-message-send-flow-MrKFxZ/screenshots/01-channel-send-finished.png
- room-send-finished: ../../../../../tmp/openshock-message-send-flow-MrKFxZ/screenshots/02-room-send-finished.png

VERDICT: PASS
