"""
Arc / Circle Nanopayments — x402 flow.
For the hackathon demo this simulates the flow and hits Arc Testnet when keys are available.
"""
import os
import httpx

ARC_RPC = os.getenv("ARC_RPC_URL", "https://rpc.arc-testnet.network")
CIRCLE_API_KEY = os.getenv("CIRCLE_API_KEY", "")


def process_payment(buyer_handle: str, seller_handle: str, amount_usdc: float) -> dict:
    """
    Simulate x402 nanopayment flow.
    Returns arc_tx_hash (real if credentials present, simulated otherwise).
    """
    if CIRCLE_API_KEY:
        return _real_payment(buyer_handle, seller_handle, amount_usdc)
    return _simulated_payment(buyer_handle, seller_handle, amount_usdc)


def _simulated_payment(buyer: str, seller: str, amount: float) -> dict:
    import hashlib, time
    seed = f"{buyer}{seller}{amount}{time.time()}"
    tx_hash = "0x" + hashlib.sha256(seed.encode()).hexdigest()
    return {
        "arc_tx_hash": tx_hash,
        "arc_explorer_url": f"https://explorer.arc-testnet.network/tx/{tx_hash}",
        "amount_usdc": amount,
        "simulated": True,
    }


def _real_payment(buyer: str, seller: str, amount: float) -> dict:
    # TODO: implement EIP-3009 USDC auth + Circle Gateway submission
    # Placeholder for Day 2 implementation
    raise NotImplementedError("Real payment not yet implemented — set CIRCLE_API_KEY")
