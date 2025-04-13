import pygame
import sys
import time
import random
from config import WIDTH, HEIGHT, FPS, SPAWN_INTERVAL, PLAYER_RADIUS

from player import Player
from enemy import Enemy
from bullet import Bullet
from utils import draw_timer, game_over_screen, update_high_scores, display_high_scores
from explosion import Explosion
from health_pickup import HealthPickUp  # 导入HP球类
from camera import Camera
from utils import resource_path


MAP_WIDTH = 8000
MAP_HEIGHT = 8000


def reset_game():
    player = Player(WIDTH // 2, HEIGHT // 2)  # 玩家初始位置
    explosions = []
    enemies = []
    bullets = []
    pickups = []  # 新增的掉落物列表
    start_time = time.time()
    score = 0
    difficulty_level = 1
    last_difficulty_increase_time = time.time()
    print(f"Initial Player HP: {player.hp}")

    spawn_event = pygame.USEREVENT + 1
    pygame.time.set_timer(spawn_event, SPAWN_INTERVAL)
    return player, explosions, enemies, bullets, pickups, start_time, spawn_event, score, difficulty_level, last_difficulty_increase_time

def main():
    pygame.init()

    # 初始化音频系统
    pygame.mixer.init()

    # 加载背景音乐（循环播放）
    pygame.mixer.music.load(resource_path("music/bg.mp3"))
    pygame.mixer.music.play(-1)  # -1 表示无限循环
    pygame.mixer.music.set_volume(0.5)  # 可调节音量（0.0 到 1.0）


    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("逃出真冬学姐的sekai")
    icon = pygame.image.load("img/player.png").convert_alpha()
    camera = Camera(MAP_WIDTH, MAP_HEIGHT)

    pygame.display.set_icon(icon)

    display_high_scores(screen)

    clock = pygame.time.Clock()

    bg_image = pygame.image.load(resource_path("img/bg.png")).convert()
    bg_image = pygame.transform.scale(bg_image, (WIDTH, HEIGHT))

    player, explosions, enemies, bullets, pickups, start_time, spawn_event, score, difficulty_level, last_difficulty_increase_time = reset_game()

    running = True
    game_over = False  # Game Over 状态变量
    while running:
        clock.tick(FPS)
        screen.blit(bg_image, (0, 0))

        elapsed_time = time.time() - start_time
        if time.time() - last_difficulty_increase_time >= 30:
            difficulty_level += 1
            last_difficulty_increase_time = time.time()
            print(f"[难度升级] 当前等级：{difficulty_level}")

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()

            if event.type == spawn_event:
                enemies.append(Enemy(WIDTH, HEIGHT, enemy_type='basic', difficulty_level=difficulty_level))
                if random.random() < 0.1:
                    enemies.append(Enemy(WIDTH, HEIGHT, enemy_type='large', difficulty_level=difficulty_level))
                if random.random() < 0.35:
                    enemies.append(Enemy(WIDTH, HEIGHT, enemy_type='fast', difficulty_level=difficulty_level))
                if random.random() < 0.5:
                    enemies.append(Enemy(WIDTH, HEIGHT, enemy_type='basic', difficulty_level=difficulty_level))

            if event.type == pygame.KEYDOWN and event.key == pygame.K_SPACE:
                if player.can_shoot():
                    bullet_count = max(1, len(enemies) // 10 + 1)
                    targets = sorted(enemies, key=lambda e: (e.x - player.x) ** 2 + (e.y - player.y) ** 2)
                    for i in range(min(bullet_count, len(targets))):
                        bullets.append(Bullet(player.x, player.y, targets[i]))
                    player.reset_shoot_time()  # 重置射击时间

        if game_over:
            # 游戏结束时，显示计时器和游戏结束画面
            survival_time = draw_timer(screen, start_time)
            pygame.display.flip()
            game_over_screen(screen, survival_time)
            pygame.time.wait(5000)  # 等待5秒显示游戏结束画面
            running = False  # 停止游戏循环

        if not game_over:
            keys = pygame.key.get_pressed()
            player.move(keys)
            player.draw(screen, camera)
            player.draw_hp(screen)  # 在玩家头像上方显示血量
            camera.update(player)

            for bullet in bullets[:]:
                bullet.move()
                bullet.draw(screen)
                if bullet.off_screen():
                    bullets.remove(bullet)

            for enemy in enemies[:]:
                enemy.move_towards(player)
                enemy.draw(screen)

                if enemy.collides_with(player):
                    if player.is_invincible():
                        continue  # 无敌状态下无视碰撞
                    print("Player collided with enemy. Game Over!")
                    print(f"Player HP: {player.hp}")
                    player.hp -= 1
                    player.activate_invincibility()  # 启动无敌状态

                    if player.hp <= 0:
                        explosions.append(Explosion(player.x, player.y, explosion_type="player"))
                        game_over = True
                        break
                    else:
                        explosions.append(Explosion(player.x, player.y))  # 普通爆炸

                    enemies.remove(enemy)
                    break

            for bullet in bullets[:]:
                for enemy in enemies[:]:
                    if bullet.hits(enemy):
                        enemy.hp -= 1
                        bullets.remove(bullet)
                        explosions.append(Explosion(enemy.x, enemy.y))
                        score += enemy.score

                        # 敌人死亡时有20%的概率掉落HP球
                        if enemy.hp <= 0 and random.random() < 0.2:
                            pickups.append(HealthPickUp(enemy.x, enemy.y))

                        if enemy.hp <= 0:
                            enemies.remove(enemy)
                        break  # 删除敌人后跳出循环

            for pickup in pickups[:]:
                pickup.draw(screen)
                if pickup.check_collision(player):
                    player.hp += 1  # 吃到HP球增加血量
                    if player.hp > player.max_hp:  # 限制最大血量
                        player.hp = player.max_hp
                    pickups.remove(pickup)

            for explosion in explosions[:]:
                explosion.update()
                explosion.draw(screen)
                if explosion.is_finished():
                    explosions.remove(explosion)

            # 显示冷却槽
            player.draw_hp(screen)
            player.draw_cooldown_bar(screen)

            draw_timer(screen, start_time)
            score_text = pygame.font.SysFont(None, 30).render(f"Score: {score}", True, (255, 255, 255))
            screen.blit(score_text, (WIDTH - score_text.get_width() - 10, 10))

            difficulty_text = pygame.font.SysFont(None, 30).render(f"Diff: {difficulty_level}", True, (255, 255, 0))
            screen.blit(difficulty_text, (10, 40))

            pygame.display.flip()

    update_high_scores(score)


if __name__ == "__main__":
    main()
