import pygame
import random
import math
import os
import time
from config import ENEMY_RADIUS, ENEMY_ACCELERATION, ENEMY_MAX_SPEED, ENEMY_HP, RED, BLACK
from enemy_bullet import EnemyBullet
from utils import resource_path

class Enemy:
    def __init__(self, width, height, enemy_type='basic', difficulty_level=1):
        self.enemy_type = enemy_type

        # 生成初始位置（四边随机）
        edge = random.choice(['top', 'bottom', 'left', 'right'])
        if edge == 'top':
            self.x, self.y = random.randint(0, width), 0
        elif edge == 'bottom':
            self.x, self.y = random.randint(0, width), height
        elif edge == 'left':
            self.x, self.y = 0, random.randint(0, height)
        else:
            self.x, self.y = width, random.randint(0, height)

        # 难度调整倍率（每级提升10%速度，20%血量）
        speed_multiplier = 1 + 0.5 * (difficulty_level - 1)
        hp_multiplier = 1 + 0.2 * (difficulty_level - 1)
        radius_multiplier = 1 + 0.5 * (difficulty_level - 1)

        # 类型调整属性
        if self.enemy_type == 'large':
            self.radius = ENEMY_RADIUS * 4.5 * radius_multiplier
            self.max_speed = (ENEMY_MAX_SPEED / 3) * speed_multiplier
            self.max_hp = ENEMY_HP * 2 * hp_multiplier  # 设置最大血量
            self.hp = self.max_hp  # 初始化当前血量为最大血量
            self.score = 5
            self.behavior_mode = 'patrol'  # large类只能有巡逻模式
            self.shoot_cooldown = None
            self.last_shot_time = 0
        elif self.enemy_type == 'fast':
            self.radius = ENEMY_RADIUS / 2 * radius_multiplier
            self.max_speed = ENEMY_MAX_SPEED * 4 * speed_multiplier
            self.max_hp = ENEMY_HP * 0.4 * hp_multiplier  # 设置最大血量
            self.hp = self.max_hp  # 初始化当前血量为最大血量
            self.score = 2
            self.behavior_mode = 'chase'  # fast类只能有追击模式
            self.shoot_cooldown = None
            self.last_shot_time = 0
        elif self.enemy_type == 'shooter':
            self.radius = ENEMY_RADIUS * 1.2 * radius_multiplier
            self.max_speed = ENEMY_MAX_SPEED * 0.8 * speed_multiplier
            self.max_hp = ENEMY_HP * 1.2 * hp_multiplier
            self.hp = self.max_hp
            self.score = 3
            self.behavior_mode = 'aggressive'
            self.shoot_cooldown = 1.5
            self.last_shot_time = 0
        else:  # basic
            self.radius = ENEMY_RADIUS * radius_multiplier
            self.max_speed = ENEMY_MAX_SPEED * speed_multiplier
            self.max_hp = ENEMY_HP * hp_multiplier  # 设置最大血量
            self.hp = self.max_hp  # 初始化当前血量为最大血量
            self.score = 1
            self.behavior_mode = random.choice(['aggressive', 'evade', 'random'])  # 普通类可以有任意攻击模式
            self.shoot_cooldown = None
            self.last_shot_time = 0

        # 初始化速度
        self.vx = self.vy = 0

        # 加载并缩放图像
        self.image = pygame.image.load(resource_path("img/enemy.png")).convert_alpha()
        self.image = pygame.transform.scale(self.image, (int(self.radius * 2), int(self.radius * 2)))

        # 初始化rect属性
        self.rect = self.image.get_rect()
        self.rect.center = (self.x, self.y)

        # 应用颜色滤镜
        if self.enemy_type == 'large':
            self.apply_color_filter((255, 0, 0))  # 红
        elif self.enemy_type == 'fast':
            self.apply_color_filter((0, 255, 0))  # 绿

        # 随机巡逻路径点（增强巡逻行为）
        self.patrol_points = [(random.randint(0, width), random.randint(0, height)) for _ in range(3)]
        self.current_patrol_point = 0

    def apply_color_filter(self, color):
        filter_surface = pygame.Surface(self.image.get_size(), pygame.SRCALPHA)
        filter_surface.fill((*color, 230))
        self.image.blit(filter_surface, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)

    def move_towards(self, player):
        dx, dy = player.x - self.x, player.y - self.y
        dist = math.hypot(dx, dy)

        # 根据行为模式调整运动逻辑
        if self.behavior_mode == 'aggressive' and self.enemy_type == 'basic':
            # 攻击模式：加速并带有扰动
            angle = math.atan2(dy, dx) + random.uniform(-0.3, 0.3)
            self.vx += ENEMY_ACCELERATION * math.cos(angle)
            self.vy += ENEMY_ACCELERATION * math.sin(angle)

            # 离玩家近时加速，远时减速
            if dist < 150:
                self.max_speed *= 1.2  # 离得近时增加速度


        elif self.behavior_mode == 'evade' and self.enemy_type == 'basic':

            safe_distance = 150  # 理想距离

            too_close = 100

            too_far = 300

            if dist < too_close:

                # 离玩家太近，反向移动（带有扰动）

                angle = math.atan2(dy, dx) + math.pi + random.uniform(-0.5, 0.5)

                speed_factor = 1.0  # 快速后退

            elif dist > too_far:

                # 太远了，朝玩家靠近

                angle = math.atan2(dy, dx) + random.uniform(-0.3, 0.3)

                speed_factor = 0.6  # 缓慢靠近

            else:

                # 在合适距离内，横向绕行，不直接靠近

                angle = math.atan2(dy, dx) + math.pi / 2 + random.uniform(-0.5, 0.5)

                speed_factor = 0.4  # 缓慢横向移动

            # 加速度控制

            self.vx += ENEMY_ACCELERATION * speed_factor * math.cos(angle)

            self.vy += ENEMY_ACCELERATION * speed_factor * math.sin(angle)

            # 限制最大速度

            speed = math.hypot(self.vx, self.vy)

            if speed > self.max_speed:
                scale = self.max_speed / speed

                self.vx *= scale

                self.vy *= scale


        elif self.behavior_mode == 'random' and self.enemy_type == 'basic':
            # 随机模式：随机方向运动
            angle = random.uniform(0, 2 * math.pi)
            self.vx += ENEMY_ACCELERATION * math.cos(angle)
            self.vy += ENEMY_ACCELERATION * math.sin(angle)

        elif self.behavior_mode == 'patrol' and self.enemy_type == 'large':
            # 巡逻模式：敌人沿设定点巡逻
            target_x, target_y = self.patrol_points[self.current_patrol_point]
            dx, dy = target_x - self.x, target_y - self.y
            angle = math.atan2(dy, dx)
            self.vx += ENEMY_ACCELERATION * math.cos(angle)
            self.vy += ENEMY_ACCELERATION * math.sin(angle)

            # 如果接近巡逻点，切换到下一个点
            if math.hypot(dx, dy) < 10:
                self.current_patrol_point = (self.current_patrol_point + 1) % len(self.patrol_points)

        elif self.behavior_mode == 'chase' and self.enemy_type == 'fast':
            # 追击模式：根据玩家位置持续追击
            angle = math.atan2(dy, dx)
            self.vx += ENEMY_ACCELERATION * math.cos(angle)
            self.vy += ENEMY_ACCELERATION * math.sin(angle)

        # 根据当前速度限制最大速度
        speed = math.hypot(self.vx, self.vy)
        if speed > self.max_speed:
            self.vx = self.max_speed * self.vx / speed
            self.vy = self.max_speed * self.vy / speed

        # 更新位置
        self.x += self.vx
        self.y += self.vy

        # 更新rect的位置
        self.rect.center = (self.x, self.y)

        # 敌人遇到屏幕边界时随机改变运动方向
        if self.x <= 0 or self.x >= pygame.display.get_surface().get_width():
            self.vx *= -1  # 水平方向反转
        if self.y <= 0 or self.y >= pygame.display.get_surface().get_height():
            self.vy *= -1  # 垂直方向反转

    def draw(self, screen, camera):
        rect = camera.apply(self.rect)
        screen.blit(self.image, rect)

        # 绘制血条：使用最大血量 (self.max_hp) 来绘制血条
        bar_back = pygame.Rect(self.x - 15, self.y - 25, 30, 5)
        bar_front = pygame.Rect(self.x - 15, self.y - 25, 30 * self.hp / self.max_hp, 5)
        pygame.draw.rect(screen, BLACK, camera.apply(bar_back))
        pygame.draw.rect(screen, RED, camera.apply(bar_front))

    def collides_with(self, player):
        return math.hypot(self.x - player.x, self.y - player.y) < (self.radius + player.radius)

    def can_shoot(self):
        return self.shoot_cooldown is not None and time.time() - self.last_shot_time >= self.shoot_cooldown

    def shoot(self, player):
        self.last_shot_time = time.time()
        return EnemyBullet(self.x, self.y, player)
