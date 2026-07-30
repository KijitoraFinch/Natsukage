# Natsukage

ブラウザを一時的なTailscaleノードとしてTailnetへ参加させ、通常の`sshd`が
動いている端末へSSHする静的Webアプリです。Tailscale SSHは使用しません。

## 開発

必要なものはNode.js 24、Git、Bashです。Tailscaleの固定ソース、Go toolchain、
Binaryen、JavaScript依存関係を初回ビルド時に取得するため、ネットワーク接続も
必要です。

```sh
npm install
npm run dev
```

`npm run dev`と`npm run build`は、最初にTailscale Connectを固定ソースから
ビルドします。入力が変わらなければ、2回目以降はローカル生成物を再利用します。
強制的に再生成する場合は`npm run vendor:rebuild`を実行してください。本番用
アセットは`npm run build`で`dist/`へ生成されます。

## 使い方

1. 「Tailscaleで接続」からTailnetへログインする
2. オンライン端末を選ぶ
3. OSユーザー名と、SSHパスワードまたはOpenSSH秘密鍵を指定する

配色はCatppuccin Mocha、Macchiato、Frappé、Latteから選択でき、選択内容は
ブラウザに保存されます。接続画面だけでなくターミナルのANSIカラーにも反映されます。

接続先ではTailscaleと通常の`sshd`を起動し、Tailnet policyでブラウザノード
から接続先のTCP/22を許可してください。`tailscale set --ssh`やTailscale
SSH policyは不要です。

SSHパスワード、秘密鍵、パスフレーズは接続時だけブラウザ内で使用し、
IndexedDBやlocalStorageには保存しません。SSHホスト鍵はfingerprintを接続中に
表示し、外側のTailscaleノード認証を信頼します。

配信元のJavaScriptやWASMは入力中の認証情報へアクセスできるため、信頼できる
配信だけを利用してください。詳細は[`SECURITY.md`](SECURITY.md)に記載しています。

## Tailnetセッション

「短時間の再接続を復元する」を選んだ場合だけ、Tailscaleのstateをブラウザの
非抽出AES-GCM鍵で暗号化してIndexedDBへ保存します。SSH認証情報はこの保存の
対象外です。

## Tailscale Connect

Tailnet接続とSSHクライアントには、BSD-3-Clauseの
[`@tailscale/connect`](https://github.com/tailscale/tailscale/tree/main/cmd/tsconnect)
を使用しています。通常の`sshd`認証を追加するため、Tailscale
`63efd0693318903e13033dda4b503c75ad7aa24e`に
[`patches/tailscale-connect-ordinary-ssh.patch`](patches/tailscale-connect-ordinary-ssh.patch)
を適用します。

生成済みのWASMやJavaScriptはリポジトリへcommitしません。
[`scripts/build-tailscale-connect.sh`](scripts/build-tailscale-connect.sh)が
固定commitだけをcheckoutし、patchの適用を検証してから、Tailscale側で固定された
Go toolchainとBinaryenを使って`vendor/tailscale-connect`へ生成します。

```sh
npm run vendor:rebuild
```

生成物には上流commit、patchのSHA-256、toolchain version、各主要artifactの
SHA-256を記録した`SOURCE.txt`を含めます。配信用の`dist/source/`にもこの情報と
patchをコピーします。

第三者コンポーネントの著作権表示とライセンス全文は
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)にまとめています。

## Forkして自己配信する

GitHubでforkし、リポジトリのSettings → Pages → Build and deploymentで
「GitHub Actions」を選択してください。
[`pages.yml`](.github/workflows/pages.yml)は、commit済みバイナリではなく
固定ソースからTailscale Connectをビルドし直してからアプリを生成し、GitHub
Pagesへ配信します。独自ドメインを使わない場合は、fork先のリポジトリ名を含む
パスへ自動的に合わせます。

ほかの静的ホストでは次を実行し、生成された`dist/`をHTTPSで配信してください。

```sh
npm ci
npm run build
```

`public/_headers`を認識するホストでは、CSPなどのセキュリティヘッダーも一緒に
設定されます。GitHub Pages向けには同等のCSPとReferrer PolicyをHTMLにも
記述しています。

[`ci.yml`](.github/workflows/ci.yml)もPull Requestごとに同じソースビルド、
アプリビルド、テストを実行します。workflowで利用するGitHub公式Actionは
release tagではなくcommit SHAで固定し、Dependabotで更新を追跡します。

## ライセンス

本プロジェクトは[`MIT License`](LICENSE)で提供します。第三者コンポーネント
には、それぞれのライセンスが適用されます。
