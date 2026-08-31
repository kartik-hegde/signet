///<reference path="types.ts" />

import express from "express";
import {
  executeAgentPayment,
  getAgentOperation,
  getBankAccountById,
  getBankAccountsByUserId,
  getTransactionById,
  getUserById,
  removeUserFromResults,
  searchUsers,
} from "./database";
import { ensureAuthenticated } from "./helpers";
import { BankAccount } from "../src/models";

const router = express.Router();

const publicTransaction = (transaction: ReturnType<typeof getTransactionById>) => ({
  id: transaction.id,
  source: transaction.source,
  amount: transaction.amount,
  description: transaction.description,
  receiverId: transaction.receiverId,
  senderId: transaction.senderId,
  status: transaction.status,
});

const publicOperation = (operation: NonNullable<ReturnType<typeof getAgentOperation>>) => ({
  operationId: operation.operationId,
  userId: operation.userId,
  transactionId: operation.transactionId,
  createdAt: operation.createdAt,
});

router.get("/context", ensureAuthenticated, (req, res) => {
  const userId = req.user!.id;
  const accounts = getBankAccountsByUserId(userId)
    .filter((account: BankAccount) => !account.isDeleted)
    .map((account: BankAccount) => ({
      id: account.id,
      bankName: account.bankName,
      accountNumberLast4: account.accountNumber.slice(-4),
    }));

  res.status(200).json({ userId, accounts });
});

router.get("/payment-users", ensureAuthenticated, (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query || query.length > 64) {
    return res.status(422).json({ error: "A search query of 1-64 characters is required." });
  }

  const users = removeUserFromResults(req.user!.id, searchUsers(query)).map((user) => ({
    id: user.id,
    username: user.username,
    displayName: `${user.firstName} ${user.lastName}`,
  }));

  return res.status(200).json({ users });
});

router.post("/payments", ensureAuthenticated, (req, res) => {
  const { operationId, sourceAccountId, receiverId, amount, description } = req.body ?? {};
  const amountNumber = Number(amount);

  if (
    typeof operationId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(operationId) ||
    typeof sourceAccountId !== "string" ||
    typeof receiverId !== "string" ||
    typeof description !== "string" ||
    !description.trim() ||
    description.length > 140 ||
    !Number.isFinite(amountNumber) ||
    amountNumber <= 0 ||
    amountNumber > 10_000 ||
    !Number.isInteger(amountNumber * 100)
  ) {
    return res.status(422).json({ error: "Invalid payment input." });
  }

  const sourceAccount = getBankAccountById(sourceAccountId);
  if (!sourceAccount || sourceAccount.userId !== req.user!.id || sourceAccount.isDeleted) {
    return res.status(403).json({ error: "The source account is not available to this user." });
  }

  if (receiverId === req.user!.id) {
    return res.status(403).json({ error: "A user cannot pay themselves." });
  }

  if (!getUserById(receiverId)) {
    return res.status(422).json({ error: "The payment recipient does not exist." });
  }

  try {
    const result = executeAgentPayment(req.user!.id, {
      operationId,
      sourceAccountId,
      receiverId,
      amount: amountNumber,
      description: description.trim(),
    });

    res.setHeader("X-Idempotent-Replay", String(result.replayed));
    return res.status(result.replayed ? 200 : 201).json({
      operation: publicOperation(result.operation),
      transaction: publicTransaction(result.transaction),
      replayed: result.replayed,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") {
      return res.status(409).json({
        error: "This operationId was already used with a different payment.",
      });
    }
    throw error;
  }
});

router.get("/payments/:operationId", ensureAuthenticated, (req, res) => {
  const operation = getAgentOperation(req.user!.id, req.params.operationId);
  if (!operation) {
    return res.status(404).json({ error: "Payment operation not found." });
  }

  const transaction = getTransactionById(operation.transactionId);
  return res.status(200).json({
    operation: publicOperation(operation),
    transaction: publicTransaction(transaction),
  });
});

export default router;
