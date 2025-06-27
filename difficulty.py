import math

class DifficultyManager:
    """Manage difficulty progression and spawn intervals."""

    def __init__(self, base_interval: int):
        self.base_interval = base_interval
        self.current_level = 1
        self.spawn_interval = base_interval

    def update(self, elapsed_time: float) -> bool:
        """Update difficulty based on elapsed time.

        Returns True if the level changed and a new spawn interval should be used.
        """
        new_level = 1 + int(elapsed_time // 30)
        if new_level != self.current_level:
            self.current_level = new_level
            # Interval decreases by 10% each level, minimum 500ms
            self.spawn_interval = max(500, int(self.base_interval * (0.9 ** (self.current_level - 1))))
            return True
        return False

    def time_to_next_level(self, elapsed_time: float) -> int:
        next_threshold = 30 * self.current_level
        return max(0, int(next_threshold - elapsed_time))
