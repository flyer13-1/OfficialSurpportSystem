const express = require("express");
const router = express.Router;

router.use(express.json);

router.post("/auto", async (req, res) => {
  try {
    // 受け取ったフォームデータ
    const date = req.body;

    // APIサーバへ転送
    const apiRes = await fetch("http://local:8080/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(date),
    });

    // APIのレスポンスを確認
    if (!apiRes.ok) {
      const errDate = await apiRes.json();
      return res.status(400).json({
        success: false,
        message: "登録に失敗しました",
        errors: errorData,
      });
    }

    // 成功時 → 必要最低限だけ返す
    return res.json({ success: true });
  } catch (err) {
    console.error("サーバ側でエラー:", err);
    res.status(500).json({ success: false, massage: "サーバ内部エラー" });
  }
});

module.exports = router;
