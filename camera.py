import pygame

class Camera:
    def __init__(self, map_width, map_height, screen_width, screen_height):
        self.map_width = map_width
        self.map_height = map_height
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.camera_rect = pygame.Rect(0, 0, screen_width, screen_height)

    def apply(self, target_rect):
        # 将目标的位置相对地图的位置转换为屏幕上的位置
        return target_rect.move(-self.camera_rect.topleft[0], -self.camera_rect.topleft[1])

    def update(self, target):
        """Update camera position based on target (usually the player)."""
        x = target.x - self.screen_width // 2
        y = target.y - self.screen_height // 2

        # Limit camera movement within map boundaries
        x = max(0, min(x, self.map_width - self.screen_width))
        y = max(0, min(y, self.map_height - self.screen_height))

        self.camera_rect = pygame.Rect(x, y, self.screen_width, self.screen_height)
