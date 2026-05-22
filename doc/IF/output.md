# API 設計書

- [API 設計書](#api-設計書)
- [概要](#概要)
- [インターフェース仕様](#インターフェース仕様)

# 概要

出力画面

# インターフェース仕様

showAll.html と同じAPIを使用。仕様は [showAll.md](showAll.md)（`GET /entries/show`）を参照。

### クエリパラメータ

//actは固定

''' json
{
act : 1
race_id :1
}

'''

| act | integer | 任意 | `1` を指定するとアクセスログを記録する |
| race_id | integer | act=1 のとき必須 | 記録対象のレースID。OutpostLogTable に username（JWTから取得）・race_id・アクセス日時を保存する |
