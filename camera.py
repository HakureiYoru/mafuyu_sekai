import pygame

class Camera:
    def __init__(self, width, height):
        self.camera_rect = pygame.Rect(0, 0, width, height)
        self.width = width
        self.height = height

    def apply(self, target_rect):
        # 将目标的位置相对地图的位置转换为屏幕上的位置
        return target_rect.move(-self.camera_rect.topleft[0], -self.camera_rect.topleft[1])

    def update(self, target):
        # 更新相机的位置，目标对象是玩家
        x = target.x - self.width // 2
        y = target.y - self.height // 2

        # 限制相机的范围，确保相机不超出地图边界
        x = max(0, min(x, self.width - self.width))
        y = max(0, min(y, self.height - self.height))

        # 设置相机的位置
        self.camera_rect = pygame.Rect(x, y, self.width, self.height)
