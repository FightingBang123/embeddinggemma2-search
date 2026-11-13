"""Rate limiting + retry helpers used by the gateway."""

import time
from dataclasses import dataclass, field


@dataclass
class TokenBucket:
    """Classic token bucket, thread-safe enough for a single event loop."""

    rate: float
    capacity: float
    tokens: float = field(init=False)
    updated: float = field(init=False)

    def __post_init__(self) -> None:
        self.tokens = self.capacity
        self.updated = time.monotonic()

    def allow(self, cost: float = 1.0) -> bool:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now
        if self.tokens >= cost:
            self.tokens -= cost
            return True
        return False


def retry(times: int = 3, base_delay: float = 0.2):
    """Exponential backoff decorator for idempotent calls."""

    def wrap(fn):
        def inner(*args, **kwargs):
            delay = base_delay
            last = None
            for attempt in range(times):
                try:
                    return fn(*args, **kwargs)
                except ValueError as exc:
                    last = exc
                    time.sleep(delay)
                    delay *= 2
            raise last

        return inner

    return wrap
