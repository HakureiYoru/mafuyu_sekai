import pygame
import math
import os
from config import WIDTH, HEIGHT, BULLET_RADIUS, BULLET_SPEED, MAP_WIDTH, MAP_HEIGHT
from utils import resource_path


class Bullet:
    shot_sound = None  # 类变量，音效只加载一次

    def __init__(self, x, y, target_enemy):
        self.x = x
        self.y = y
        self.radius = BULLET_RADIUS

        original_image = pygame.image.load(resource_path("img/bullet.png")).convert_alpha()
        original_image = pygame.transform.scale(original_image, (self.radius * 2, self.radius * 2))

        # 默认方向向上，计算朝向角度
        if target_enemy:
            dx = target_enemy.x - self.x
            dy = target_enemy.y - self.y
            dist = math.hypot(dx, dy)
            if dist == 0:
                dist = 1
            self.vx = BULLET_SPEED * dx / dist
            self.vy = BULLET_SPEED * dy / dist

            # 计算朝向角度，注意 pygame 中角度是逆时针、0°向右
            angle_rad = math.atan2(-dy, dx)  # -dy 是因为 y 轴朝下
            angle_deg = math.degrees(angle_rad) - 90  # 默认子弹图像向上，修正偏移
        else:
            self.vx = 0
            self.vy = -BULLET_SPEED
            angle_deg = 0

        # 旋转贴图，使其朝向敌人
        self.image = pygame.transform.rotate(original_image, angle_deg)

        # 设置矩形区域
        self.rect = self.image.get_rect()
        self.rect.center = (self.x, self.y)

        # 加载并播放发射音效（只加载一次）
        if Bullet.shot_sound is None:
            Bullet.shot_sound = pygame.mixer.Sound(resource_path(os.path.join("sound", "shot.wav")))
            Bullet.shot_sound.set_volume(0.3)  # 设置音量，范围 0~1

        # 播放音效
        Bullet.shot_sound.play()

    def move(self):
        self.x += self.vx
        self.y += self.vy
        self.rect.center = (self.x, self.y)

    def draw(self, screen, camera):
        screen.blit(self.image, camera.apply(self.rect))

    def off_screen(self):
        margin = 20
        return (
                self.x < -margin or self.x > MAP_WIDTH + margin or
                self.y < -margin or self.y > MAP_HEIGHT + margin
        )

    def hits(self, enemy):
        dx = self.x - enemy.x
        dy = self.y - enemy.y
        distance = math.hypot(dx, dy)
        return distance < (self.radius + enemy.radius)
