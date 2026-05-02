const readline = require("readline");
const bip39 = require("bip39");

const { createHDWallet, deriveAddress } = require("./wallet");
const {
  loadWallet,
  initWallet,
  getNextIndex,
  incrementIndex,
} = require("./walletStore");

const { getBalance } = require("./balance");
const { sendBTC } = require("./send");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

(async () => {
  let wallet = loadWallet();

  if (!wallet) {
    console.log("1. Create wallet");
    console.log("2. Import wallet");

    rl.question("Choose: ", async (choice) => {
      if (choice === "1") {
        const mnemonic = await createHDWallet();
        initWallet(mnemonic);
        console.log("New wallet:", mnemonic);
      } else {
        rl.question("Enter mnemonic: ", (m) => {
          if (!bip39.validateMnemonic(m)) {
            console.log("Invalid mnemonic");
            rl.close();
            return;
          }
          initWallet(m);
          console.log("Wallet imported.");
          rl.close();
        });
      }
    });

    return;
  }

  const index = getNextIndex();
  const addr = await deriveAddress(wallet.mnemonic, index);

  console.log("Deposit Address:", addr.address);

  incrementIndex();

  const balance = await getBalance(addr.address);
  console.log("Balance:", balance);

  console.log("\nSend BTC (address amount_sats)");

  rl.question("Send? ", async (input) => {
    const [to, amount] = input.split(" ");

    try {
      const txid = await sendBTC(
        wallet.mnemonic,
        index,
        to,
        parseInt(amount)
      );

      console.log("TX sent:", txid);
    } catch (e) {
      console.error("Error:", e.message);
    }

    rl.close();
  });
})();