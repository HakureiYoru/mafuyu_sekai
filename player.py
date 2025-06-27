import pygame
import time
import math
from config import PLAYER_RADIUS

from utils import resource_path  # 从 utils 中引入


class Player:
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.radius = PLAYER_RADIUS
        self.max_hp = 3
        self.hp = self.max_hp
        self.cooldown_time = 0.2  # 射击冷却时间
        self.last_shot_time = 0
        self.bomb_count = 0

        self.invincible = False
        self.invincible_start_time = 0
        self.invincible_duration = 3  # 秒

        # 加载玩家的图片
        self.image = pygame.image.load(resource_path("img/player.png")).convert_alpha()
        self.image = pygame.transform.scale(self.image, (self.radius * 2, self.radius * 2))

        self.rect = self.image.get_rect()
        self.rect.center = (self.x, self.y)

    def is_invincible(self):
        return self.invincible and (time.time() - self.invincible_start_time) < self.invincible_duration

    def activate_invincibility(self):
        self.invincible = True
        self.invincible_start_time = time.time()

    def move(self, keys):
        speed = 5
        if keys[pygame.K_LEFT]:
            self.x -= speed
        if keys[pygame.K_RIGHT]:
            self.x += speed
        if keys[pygame.K_UP]:
            self.y -= speed
        if keys[pygame.K_DOWN]:
            self.y += speed

        self.rect.center = (self.x, self.y)

    def draw(self, screen, camera):
        screen.blit(self.image, camera.apply(self.rect))

        if self.is_invincible():
            # 绘制金色护盾圈
            shield_radius = self.radius + 10
            shield_pos = camera.apply(self.rect).center
            pygame.draw.circle(screen, (255, 215, 0), shield_pos, shield_radius, 3)  # 金色、3px宽

    def can_shoot(self):
        current_time = time.time()
        if current_time - self.last_shot_time >= self.cooldown_time:
            return True
        return False

    def reset_shoot_time(self):
        self.last_shot_time = time.time()

    def collides_with(self, enemy):
        dx = self.x - enemy.x
        dy = self.y - enemy.y
        distance = math.hypot(dx, dy)
        return distance < (self.radius + enemy.radius)

    def take_damage(self):
        self.hp -= 1
        if self.hp <= 0:
            self.hp = 0  # 保证血量不会小于0
            return True  # 如果血量小于等于0，表示死亡
        return False

    def draw_cooldown_bar(self, screen):
        cooldown_bar_width = 100  # 固定宽度
        cooldown_bar_height = 10
        cooldown_bar_x = self.x - cooldown_bar_width / 2
        cooldown_bar_y = self.y - self.radius - 20

        # 计算进度条填充的进度
        progress = (time.time() - self.last_shot_time) / self.cooldown_time

        # 限制进度条的宽度，确保它不会超出屏幕宽度
        filled_width = min(cooldown_bar_width * progress, cooldown_bar_width)

        # 绘制背景冷却条
        pygame.draw.rect(screen, (0, 0, 0), (cooldown_bar_x, cooldown_bar_y, cooldown_bar_width, cooldown_bar_height))

        # 绘制进度条
        pygame.draw.rect(screen, (0, 255, 0), (cooldown_bar_x, cooldown_bar_y, filled_width, cooldown_bar_height))

    def draw_hp(self, screen):
        hp_bar_width = 100
        hp_bar_height = 10
        hp_bar_x = self.x - hp_bar_width / 2
        hp_bar_y = self.y - self.radius - 40

        pygame.draw.rect(screen, (0, 0, 0), (hp_bar_x, hp_bar_y, hp_bar_width, hp_bar_height))

        # 防止血量超过最大值
        hp_progress = max(0, min(self.hp / 3, 1))  # 确保hp_progress在0到1之间
        pygame.draw.rect(screen, (255, 0, 0), (hp_bar_x, hp_bar_y, hp_bar_width * hp_progress, hp_bar_height))

    def draw_bomb_count(self, screen):
        bomb_text = pygame.font.SysFont(None, 30).render(f"Bombs: {self.bomb_count}", True, (255, 255, 255))
        screen.blit(bomb_text, (10, 70))
